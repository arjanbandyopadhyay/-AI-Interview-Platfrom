import express from "express"
import isAuth from "../middleware/isAuth.js"
import { createOrder, verifyPayment } from "../controllers/payment.controller.js"
import { paymentLimiter } from "../middleware/limiters.js"


const paymentRouter=express.Router()
paymentRouter.post('/order',isAuth,paymentLimiter,createOrder)
paymentRouter.post('/verify',isAuth,paymentLimiter,verifyPayment)

export default paymentRouter