import mongoose from 'mongoose';
const questionsSchema= new mongoose .Schema({
   question:String,
   difficulty:String,
   timeLimit:Number,
   answer:String,
   feedback:String,
   score:{type: Number,default:0},
   confidence:{type: Number,default:0},
   communication:{type: Number,default:0},
   correctness:{type: Number,default:0},

})
const interviewSchema=new mongoose.Schema({
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:true
    },
        role:{
           type:String,
           requried:true,
        },
        experience:{
            type:String,
            requried:true
        },
        mode:{
            type:String,
            enum:["HR" , "Technical"],
            requried:true
        },
        resumeText:{
            type:String

        },
        questions:[questionsSchema],
        finalScore:{type:Number, default:0},
        status:{
            type:String,
            enum:["Incompleted","completed"],
            default:"Incompleted"
        }
},{timestamps:true})

// "My interviews" runs find({ userId }).sort({ createdAt: -1 }). Without this index MongoDB scans every
// interview in the collection and sorts the matches in memory; with it, it reads one user's interviews
// already in order.
interviewSchema.index({ userId: 1, createdAt: -1 })

const Interview=mongoose.model("Interview",interviewSchema)

export default Interview