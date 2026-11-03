import Payment from "../models/payment.models.js";
import User from "../models/users.js";
import razorpay from "../services/razorpay.service.js";
import { getPaidPlan } from "../config/plans.js";
import crypto from 'crypto'

// Constant-time comparison of two hex signatures (also rejects different lengths / non-hex input).
const safeEqualHex = (expected, given) => {
    if (typeof given !== "string" || given.length !== expected.length || !/^[a-f0-9]+$/i.test(given)) return false
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"))
}

export const createOrder=async (req,res)=>{
    try {
        // The price and the credits come from the server's plan table, never from the request body.
        const planId=req.body?.planId
        const plan=getPaidPlan(planId)
        if(!plan){
            return res.status(400).json({message:'Invalid plan'})
        }
        const order=await razorpay.orders.create({
            amount:plan.amount*100,
            currency:'INR',
            receipt:`receipt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
        })
        await Payment.create({
           userId:req.userId,
           planId,
           amount:plan.amount,
           credits:plan.credits,
           razorpayOrderId:order.id,
           status:'created'
        })
        return res.json(order);
    } catch (error) {
        console.error("createOrder Error:",error)
        return res.status(500).json({message:'Failed to create the payment order'})
    }
}

export const verifyPayment=async (req,res)=>{
    try {
        const {razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body ?? {};
        const fields=[razorpay_order_id,razorpay_payment_id,razorpay_signature]
        if(!fields.every((v)=>typeof v==="string" && v.length>0 && v.length<=200)){
            return res.status(400).json({message:'Missing payment details'})
        }

        const expectedSignature=crypto
            .createHmac("sha256",process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex')
        if(!safeEqualHex(expectedSignature,razorpay_signature)){
            return res.status(400).json({message:'Invalid payment signature'})
        }

        // Claim the payment atomically: only one request can move it from "created" to "paid",
        // so double-clicks or parallel requests cannot add the credits twice.
        // The order must also belong to the logged-in user.
        const payment=await Payment.findOneAndUpdate(
            {razorpayOrderId:razorpay_order_id,userId:req.userId,status:'created'},
            {$set:{status:'paid',razorpayPaymentId:razorpay_payment_id}},
            {returnDocument:"after"}
        )
        if(!payment){
            const existing=await Payment.findOne({razorpayOrderId:razorpay_order_id,userId:req.userId})
            if(!existing){
                return res.status(404).json({message:"Payment not found"})
            }
            const user=await User.findById(req.userId)
            return res.json({success:true,message:'Already Processed',user})
        }

        try {
            const updatedUser=await User.findByIdAndUpdate(payment.userId,{
                $inc:{credits:payment.credits}
            },{returnDocument:"after"})
            return res.json({
                success:true,
                message:'Payment verified and credits added',
                user:updatedUser
            })
        } catch (error) {
            // Could not add the credits: release the claim so the user can retry the verification.
            await Payment.updateOne({_id:payment._id},{$set:{status:'created'},$unset:{razorpayPaymentId:""}})
            throw error
        }
    } catch (error) {
        console.error("verifyPayment Error:",error)
        return res.status(500).json({message:'Failed to verify the payment'})
    }
}
