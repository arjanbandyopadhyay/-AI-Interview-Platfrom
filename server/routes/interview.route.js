import express from "express"
import isAuth from "../middleware/isAuth.js"
import { uploadResume } from "../middleware/multer.js"
import { resumeLimiter, generateLimiter, answerLimiter } from "../middleware/limiters.js"
import { analyseResume, finishInterview, generateQuestion, getInterviewReport, getMyInterviews, submitAnswer } from "../controllers/interview.Controller.js"

const interviewRouter=express.Router()


interviewRouter.post("/resume",isAuth,resumeLimiter,uploadResume,analyseResume)
interviewRouter.post("/generate-questions",isAuth,generateLimiter,generateQuestion)
interviewRouter.post("/submit-answer",isAuth,answerLimiter,submitAnswer)
interviewRouter.post("/finish",isAuth,finishInterview)

interviewRouter.get("/get-interview",isAuth,getMyInterviews)
interviewRouter.get("/report/:id",isAuth,getInterviewReport)

export default interviewRouter