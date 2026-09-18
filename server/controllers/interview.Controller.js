import fs from 'fs';
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { askAi } from '../services/openRouter.services.js';
import User from '../models/users.js';
import Interview from '../models/interview.model.js';

export const analyseResume = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "Resume required" });
        }
        const filepath = req.file.path;
        const filebuffer = await fs.promises.readFile(filepath);
        const uint8Array = new Uint8Array(filebuffer);
        const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;

        let resumeText = '';
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(" ");
            resumeText += pageText + "\n";
        }

        resumeText = resumeText.replace(/\s+/g, " ").trim();

        const messages = [
            {
                role: "system",
                content: `Extract structured data from resume
                Return strictly JSON:{
                "role":"string",
                "experience":"string",
                "projects":["project1","project2"],
                "skills":["skill1","skill2"]
                }`
            },
            {
                role: "user",
                content: resumeText
            }
        ];

        const aiResponse = await askAi(messages);
        const cleanJson = aiResponse.replace(/```json|```/gi, '').trim();
        const parsed = JSON.parse(cleanJson);
        
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }

        return res.json({
            role: parsed.role,
            experience: parsed.experience,
            projects: parsed.projects,
            skills: parsed.skills,
            resumeText
        });

    } catch (error) {
        console.error("analyseResume Error:", error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(500).json({ message: error.message });
    }
};

export const generateQuestion = async (req, res) => {
    try {
        let { role, experience, mode, resumeText, projects, skills } = req.body;

        role = role?.trim();
        experience = experience?.trim();
        mode = mode?.trim();

        if (!role || !experience || !mode) {
            return res.status(400).json({ message: "Role, Experience, and Mode are required" });
        }

        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(400).json({ message: "User not Found" });
        }
        if (user.credits < 50) {
            return res.status(400).json({ message: "Not enough Credits. Minimum 50 Credits required" });
        }

        const projectText = Array.isArray(projects) && projects.length ? projects.join(", ") : "None";
        const skillsText = Array.isArray(skills) && skills.length ? skills.join(", ") : "None";
        const safeResume = typeof resumeText === 'string' ? resumeText.trim() : (resumeText?.text?.trim() || "None");

        const userPrompt = `
        Role:${role}
        Experience:${experience}
        Skills:${skillsText}
        Projects:${projectText}
        InterviewMode:${mode}
        Resume:${safeResume}`;

        const messages = [
            {
                role: "system",
                content: `
You are a real human interviewer conducting a professional interview.
Speak in simple, natural English as if you are directly talking to the candidate.
Generate exactly 6 interview questions.

Strict Rules:
- First ask for the candidate's introduction, then ask technical questions.
- Each question must contain between 15 and 25 words.
- Each question must be a single complete sentence.
- Do NOT number them.
- Do NOT add explanations or extra text.
- One question per line only.

Difficulty progression:
Question 1 → easy (Intro Question)
Question 2 → medium
Question 3 → medium
Question 4 → medium
Question 5 → hard
Question 6 → hard
`
            },
            {
                role: "user",
                content: userPrompt
            }
        ];

        const aiResponse = await askAi(messages);
        if (!aiResponse || !aiResponse.trim()) {
            return res.status(500).json({ message: "AI returned empty response" });
        }

        const questionArray = aiResponse
            .split("\n")
            .map(q => q.trim())
            .filter(q => q.length > 0)
            .slice(0, 6);

        if (questionArray.length === 0) {
            return res.status(500).json({ message: "AI failed to generate questions" });
        }

        user.credits -= 50;
        await user.save();

        const interview = await Interview.create({
            userId: user._id,
            role,
            experience,
            mode,
            resumeText: safeResume,
            questions: questionArray.map((q, index) => ({
                question: q,
                difficulty: ['easy', 'medium', 'medium', 'medium', 'hard', 'hard'][index],
                timeLimit: [60, 90, 90, 90, 120, 120][index]
            }))
        });

        return res.json({
            interviewId: interview._id,
            creditsLeft: user.credits,
            userName: user.name,
            questions: interview.questions
        });

    } catch (error) {
        console.error("generateQuestion Error:", error);
        return res.status(500).json({ message: `Failed to create Interview: ${error.message}` });
    }
};

export const submitAnswer = async (req, res) => {
    try {
        const { interviewId, questionIndex, answer, timeTaken } = req.body;
        const interview = await Interview.findById(interviewId);
        
        if (!interview) {
            return res.status(404).json({ message: "Interview not found" });
        }

        const question = interview.questions[questionIndex];
        if (!question) {
            return res.status(400).json({ message: "Invalid question index" });
        }

        if (!answer) {
            question.score = 0;
            question.feedback = "You did not submit an answer";
            question.answer = "";
            await interview.save();
            return res.json({ feedback: question.feedback });
        }

        if (timeTaken > question.timeLimit) {
            question.score = 0;
            question.feedback = "Time limit exceeded. Answer not evaluated.";
            question.answer = answer;
            await interview.save();
            return res.json({ feedback: question.feedback });
        }

        const messages = [
            {
                role: "system",
                content: `
You are a professional human interviewer evaluating a candidate's answer.
Return ONLY valid JSON in this format:
{
  "confidence": number,
  "communication": number,
  "correctness": number,
  "finalScore": number,
  "feedback": "short human feedback (10-15 words)"
}
`
            },
            {
                role: "user",
                content: `Question: ${question.question}\nAnswer: ${answer}`
            }
        ];

        const aiResponse = await askAi(messages);
        const cleanJson = aiResponse.replace(/```json|```/gi, '').trim();
        const parsed = JSON.parse(cleanJson);

        question.answer = answer;
        question.confidence = parsed.confidence || 0;
        question.communication = parsed.communication || 0;
        question.correctness = parsed.correctness || 0;
        question.score = parsed.finalScore || 0;
        question.feedback = parsed.feedback || "Good response.";

        await interview.save();

        return res.status(200).json({ feedback: question.feedback });

    } catch (error) {
        console.error("submitAnswer Error:", error);
        return res.status(500).json({ message: `Failed to submit answer: ${error.message}` });
    }
};

export const finishInterview = async (req, res) => {
    try {
        const { interviewId } = req.body;
        const interview = await Interview.findById(interviewId);
        
        if (!interview) {
            return res.status(404).json({ message: "Failed to find interview" });
        }

        const totalQuestions = interview.questions ? interview.questions.length : 0;
        let totalScore = 0;
        let totalConfidence = 0;
        let totalCommunication = 0;
        let totalCorrectness = 0;

      
        if (Array.isArray(interview.questions)) {
            interview.questions.forEach((q) => {
                totalScore += q.score || 0;
                totalConfidence += q.confidence || 0;
                totalCommunication += q.communication || 0;
                totalCorrectness += q.correctness || 0;
            });
        }

        const finalScore = totalQuestions ? totalScore / totalQuestions : 0;
        const avgConfidence = totalQuestions ? totalConfidence / totalQuestions : 0;
        const avgCommunication = totalQuestions ? totalCommunication / totalQuestions : 0;
        const avgCorrectness = totalQuestions ? totalCorrectness / totalQuestions : 0;

        interview.finalScore = Number(finalScore.toFixed(1));
        interview.status = "completed";

        await interview.save();

        return res.status(200).json({
            finalScore: Number(finalScore.toFixed(1)),
            confidence: Number(avgConfidence.toFixed(1)),
            communication: Number(avgCommunication.toFixed(1)),
            correctness: Number(avgCorrectness.toFixed(1)),
            questionWiseScore: interview.questions.map((q) => ({
                question: q.question,
                score: Number((q.score || 0).toFixed(1),
                feedback: q.feedback || "",
                confidence: q.confidence || 0,
                communication: q.communication || 0,
                correctness: q.correctness || 0,
            })),
        });

    } catch (error) {
        console.error("finishInterview Error:", error);
        return res.status(500).json({ message: `Failed to finish interview: ${error.message}` });
    }
};

export const getMyInterviews= async(req,res)=>{
    try {
      const interview= await Interview.find({userId:req.userId}) 
      .sort ({createAt:-1}) 
      .select("role experience mode finalScore status createdAt");
      return res.status(200).json(interview)
    } catch (error) {
       return res.status(500).json({ message: `Failed to find current interview: ${error}` }); 
    }
}

export const getInterviewReport= async (req,res)=>{
    try {
        const interview=await Interview.findById(req.params.id)

        if(!interview){
         return res.status(404).json({message:"Interview not Found"})   
        }
        const totalQuestions = interview.questions ? interview.questions.length : 0;
        
        let totalConfidence = 0;
        let totalCommunication = 0;
        let totalCorrectness = 0;

      
        if (Array.isArray(interview.questions)) {
            interview.questions.forEach((q) => {
                totalConfidence += q.confidence || 0;
                totalCommunication += q.communication || 0;
                totalCorrectness += q.correctness || 0;
            });
        }

        const avgConfidence = totalQuestions ? totalConfidence / totalQuestions : 0;
        const avgCommunication = totalQuestions ? totalCommunication / totalQuestions : 0;
        const avgCorrectness = totalQuestions ? totalCorrectness / totalQuestions : 0;

        return res.json({
            finalScore:interview.finalScore,
            confidence:Number(avgConfidence.toFixed(1)),
            communication:Number(avgCommunication.toFixed(1)),
            correctness:Number(avgCorrectness.toFixed(1)),
            questionWiseScore:interview.questions
        })

    } catch (error) {
         return res.status(500).json({ message: `Failed to find current interview report: ${error}` });
    }
}
