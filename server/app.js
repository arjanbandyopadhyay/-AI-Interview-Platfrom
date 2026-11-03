import express from "express"
import cookieParser from "cookie-parser"
import cors from "cors"
import authRouter from "./routes/auth.route.js"
import userRouter from "./routes/user.route.js"
import interviewRouter from "./routes/interview.route.js"
import paymentRouter from "./routes/payment.route.js"
import { globalLimiter, authLimiter } from "./middleware/limiters.js"

// The Express app without starting a server, so tests can run it over real HTTP.
const app=express()

// Render (like most hosts) puts a proxy in front of the app. Trust one hop so req.ip is the real client
// address; without this every user would share the proxy's IP and therefore one rate limit.
app.set("trust proxy",Number(process.env.TRUST_PROXY ?? 1))

app.use(cors({
    // set CLIENT_URL (e.g. http://localhost:5173) for local development
    origin:process.env.CLIENT_URL || "https://ai-interview-platfrom-client.onrender.com",
    credentials:true
}))

app.use(globalLimiter)   // after cors(), so 429 responses still carry the CORS headers
app.use(express.json({limit:"100kb"}))
app.use(cookieParser())

app.use("/api/auth" ,authLimiter,authRouter)
app.use("/api/user",userRouter)
app.use("/api/interview",interviewRouter)
app.use("/api/payment",paymentRouter)

app.use((req,res)=>res.status(404).json({message:"Not found"}))

// Last-resort error handler: JSON instead of Express' default HTML page, which includes a stack trace
// unless NODE_ENV=production.
app.use((err,req,res,next)=>{
    const status=Number.isInteger(err?.status) && err.status>=400 && err.status<500 ? err.status : 500
    if(status===500) console.error("Unhandled error:",err)
    const message=status===500 ? "Something went wrong" : status===413 ? "Request is too large" : "Invalid request"
    res.status(status).json({message})
})

export default app
