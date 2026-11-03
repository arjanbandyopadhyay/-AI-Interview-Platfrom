import multer from "multer"
import path from "path"
import crypto from "crypto"

const storage=multer.diskStorage({
    destination:function(req,file,cb){
        cb(null,"public")
    },
    filename:function(req,file,cb){
        // never trust the client's file name: use a random name
        cb(null,`${Date.now()}-${crypto.randomUUID()}.pdf`)
    }
})

// Only PDFs are accepted (the resume parser only understands PDF).
const fileFilter=(req,file,cb)=>{
    const isPdf=file.mimetype==="application/pdf" && path.extname(file.originalname).toLowerCase()===".pdf"
    if(!isPdf) return cb(new Error("Only PDF resumes are allowed"))
    cb(null,true)
}

export const upload=multer({
    storage,
    limits:{fileSize:5*1024*1024,files:1},
    fileFilter
})

// Wrapper that turns upload errors into a clean 400 JSON response instead of a stack trace.
export const uploadResume=(req,res,next)=>{
    upload.single("resume")(req,res,(err)=>{
        if(!err) return next()
        const message=err.code==="LIMIT_FILE_SIZE" ? "Resume must be smaller than 5 MB" : (err.message || "Invalid upload")
        return res.status(400).json({message})
    })
}
