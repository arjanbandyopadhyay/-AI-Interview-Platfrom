import genToken from "../config/Token.js"
import User from "../models/users.js"
import { verifyFirebaseIdToken } from "../config/firebaseAdmin.js"

export const googleAuth=async(req,res)=>{
    try {
        const {idToken}=req.body ?? {}
        if(typeof idToken!=="string" || !idToken || idToken.length>4096){
            return res.status(400).json({message:"A Google sign-in token is required"})
        }

        // Identity comes from the verified token, never from the request body.
        let decoded
        try {
            decoded=await verifyFirebaseIdToken(idToken)
        } catch {
            return res.status(401).json({message:"Invalid or expired sign-in. Please sign in again."})
        }
        const email=typeof decoded.email==="string" ? decoded.email.trim() : ""
        if(!email || decoded.email_verified===false){
            return res.status(401).json({message:"Your Google account must have a verified email"})
        }
        const name=(typeof decoded.name==="string" && decoded.name.trim()) || email.split("@")[0]

        let user=await User.findOne({email})
        if(!user){
            try {
                user=await User.create({name,email})
            } catch (error) {
                // two first-time logins at the same moment: the other request created the user
                if(error?.code===11000) user=await User.findOne({email})
                else throw error
            }
        }
        let token=await genToken(user._id)
        res.cookie("token",token,{
            httpOnly:true,
            secure:true,
            sameSite:"none",
            maxAge:7*24*60*60*1000
        })

        return res.status(200).json(user)
    } catch (error) {
        console.error("googleAuth Error:",error)
        return res.status(500).json({message:"Sign-in failed. Please try again."})
    }
}

export const logOut=async(req,res)=>{
    try {
        await res.clearCookie("token")
        return res.status(200).json({message:"LogOut SuccesFully"})
    } catch (error) {
        return res.status(500).json({message:`Google Auth Error ${error}`})
    }
}
