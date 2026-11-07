import mongoose from 'mongoose'

const paymentSchema=new mongoose.Schema({
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'User',
        required:true,
    },
    planId: String,
    amount: Number,
    credits:Number,
    razorpayOrderId:String,
    razorpayPaymentId:String,
    status:{
        type:String,
        enum:['created','paid','failed'],
        default:'created'
    }
},{timestamps:true})

// verifyPayment looks the order up by razorpayOrderId (plus userId and status).
paymentSchema.index({ razorpayOrderId: 1 })

const Payment=mongoose.model('Payment',paymentSchema)

export default Payment