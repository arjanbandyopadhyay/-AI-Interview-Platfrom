import fs from 'fs';
import { askAi } from '../services/openRouter.services.js';
import User from '../models/users.js';
import Interview from '../models/interview.model.js';
import { LIMITS } from '../config/limits.js';
import { isObjectIdString, cleanString, cleanList } from '../utils/validators.js';
const clampScore = (val, max = 10) => {
    const n = Number(val);
    if (isNaN(n)) return 0;
    return Math.min(Math.max(n, 0), max);
};

export const analyseResume = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "Resume required" });
        }
        const filepath = req.file.path;
        // loaded on first use: pdf.js is heavy and only this endpoint needs it
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const filebuffer = await fs.promises.readFile(filepath);
        const uint8Array = new Uint8Array(filebuffer);
        const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
        if (pdf.numPages > LIMITS.MAX_RESUME_PAGES) {
            await fs.promises.unlink(filepath).catch(() => {});
            return res.status(400).json({ message: `Resume is too long (max ${LIMITS.MAX_RESUME_PAGES} pages)` });
        }

        let resumeText = '';
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(" ");
            resumeText += pageText + "\n";
        }

        resumeText = resumeText.replace(/\s+/g, " ").trim().slice(0, LIMITS.MAX_RESUME_CHARS);
        if (!resumeText) {
            await fs.promises.unlink(filepath).catch(() => {});
            return res.status(400).json({ message: "Could not read any text from this PDF. Please upload a text-based resume." });
        }

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
            role: cleanString(parsed.role).slice(0, LIMITS.MAX_FIELD_CHARS),
            experience: cleanString(parsed.experience).slice(0, LIMITS.MAX_FIELD_CHARS),
            projects: cleanList(parsed.projects, LIMITS.MAX_LIST_ITEMS, LIMITS.MAX_FIELD_CHARS),
            skills: cleanList(parsed.skills, LIMITS.MAX_LIST_ITEMS, LIMITS.MAX_FIELD_CHARS),
            resumeText
        });

    } catch (error) {
        console.error("analyseResume Error:", error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        if (error?.name === "InvalidPDFException" || error?.name === "FormatError") {
            return res.status(400).json({ message: "Could not read this file. Please upload a valid PDF resume." });
        }
        return res.status(500).json({ message: "Could not analyse the resume. Please try again." });
    }
};

export const generateQuestion = async (req, res) => {
    try {
        const body = req.body ?? {};
        const role = cleanString(body.role);
        const experience = cleanString(body.experience);
        const mode = cleanString(body.mode);

        if (!role || !experience || !mode) {
            return res.status(400).json({ message: "Role, Experience, and Mode are required" });
        }
        if (role.length > LIMITS.MAX_FIELD_CHARS || experience.length > LIMITS.MAX_FIELD_CHARS) {
            return res.status(400).json({ message: `Role and Experience must be at most ${LIMITS.MAX_FIELD_CHARS} characters` });
        }
        if (!["HR", "Technical"].includes(mode)) {
            return res.status(400).json({ message: "Mode must be HR or Technical" });
        }

        const projectList = cleanList(body.projects, LIMITS.MAX_LIST_ITEMS, LIMITS.MAX_FIELD_CHARS);
        const skillList = cleanList(body.skills, LIMITS.MAX_LIST_ITEMS, LIMITS.MAX_FIELD_CHARS);
        const projectText = projectList.length ? projectList.join(", ") : "None";
        const skillsText = skillList.length ? skillList.join(", ") : "None";
        const rawResume = typeof body.resumeText === 'string' ? body.resumeText
            : (typeof body.resumeText?.text === 'string' ? body.resumeText.text : "");
        const safeResume = rawResume.trim().slice(0, LIMITS.MAX_RESUME_CHARS) || "None";

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

        // Take the credits BEFORE the paid LLM call, in one atomic step that also checks the balance.
        // (Checking first and deducting later let parallel requests all pass the check.)
        const cost = LIMITS.CREDITS_PER_INTERVIEW;
        const user = await User.findOneAndUpdate(
            { _id: req.userId, credits: { $gte: cost } },
            { $inc: { credits: -cost } },
            { returnDocument: "after" }
        );
        if (!user) {
            const exists = await User.exists({ _id: req.userId });
            return res.status(400).json({
                message: exists ? `Not enough Credits. Minimum ${cost} Credits required` : "User not Found"
            });
        }

        // From here on, any failure gives the credits back.
        const refund = async () => {
            try {
                await User.updateOne({ _id: req.userId }, { $inc: { credits: cost } });
            } catch (refundError) {
                console.error(`REFUND FAILED for user ${req.userId} (${cost} credits):`, refundError);
            }
        };

        try {
            const aiResponse = await askAi(messages);
            if (!aiResponse || !aiResponse.trim()) {
                await refund();
                return res.status(500).json({ message: "AI returned empty response" });
            }

            const questionArray = aiResponse
                .split("\n")
                .map(q => q.trim())
                .filter(q => q.length > 0)
                .slice(0, 6);

            if (questionArray.length === 0) {
                await refund();
                return res.status(500).json({ message: "AI failed to generate questions" });
            }

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
            await refund();
            throw error;
        }

    } catch (error) {
        console.error("generateQuestion Error:", error);
        return res.status(500).json({ message: "Failed to create the interview. You were not charged." });
    }
};

export const submitAnswer = async (req, res) => {
    try {
        const { interviewId, questionIndex, answer, timeTaken } = req.body ?? {};
        if (!isObjectIdString(interviewId)) {
            return res.status(400).json({ message: "Invalid interview id" });
        }
        const index = Number(questionIndex);
        if (!Number.isInteger(index) || index < 0) {
            return res.status(400).json({ message: "Invalid question index" });
        }

        // Only the owner may answer: look the interview up by id AND user.
        const interview = await Interview.findOne({ _id: interviewId, userId: req.userId });
        if (!interview) {
            return res.status(404).json({ message: "Interview not found" });
        }
        if (interview.status === "completed") {
            return res.status(409).json({ message: "Interview already completed" });
        }

        const question = interview.questions[index];
        if (!question) {
            return res.status(400).json({ message: "Invalid question index" });
        }

        // Already evaluated: return the stored feedback instead of paying for another LLM call
        // (and so a score cannot be re-rolled by submitting the same question again).
        if (question.feedback) {
            return res.json({ feedback: question.feedback });
        }

        const text = typeof answer === "string" ? answer.trim() : "";
        if (!text) {
            question.score = 0;
            question.feedback = "You did not submit an answer";
            question.answer = "";
            await interview.save();
            return res.json({ feedback: question.feedback });
        }
        if (text.length > LIMITS.MAX_ANSWER_CHARS) {
            return res.status(400).json({ message: `Answer is too long (max ${LIMITS.MAX_ANSWER_CHARS} characters)` });
        }

        if (Number(timeTaken) > question.timeLimit) {
            question.score = 0;
            question.feedback = "Time limit exceeded. Answer not evaluated.";
            question.answer = text;
            await interview.save();
            return res.json({ feedback: question.feedback });
        }

        const messages = [
            {
                role: "system",
                content: `
You are a professional human interviewer evaluating a candidate's answer.
Score confidence, communication, and correctness each strictly on a scale of 0 to 10.
finalScore must also be strictly between 0 and 10 - it is an overall rating,
NOT the sum of the other three scores.
Return ONLY valid JSON in this format:
{
  "confidence": number (0-10),
  "communication": number (0-10),
  "correctness": number (0-10),
  "finalScore": number (0-10),
  "feedback": "short human feedback (10-15 words)"
}
`
            },
            {
                role: "user",
                content: `Question: ${question.question}\nAnswer: ${text}`
            }
        ];

        const aiResponse = await askAi(messages);
        const cleanJson = aiResponse.replace(/```json|```/gi, '').trim();
        const parsed = JSON.parse(cleanJson);

        
        question.answer = text;
        question.confidence = clampScore(parsed.confidence);
        question.communication = clampScore(parsed.communication);
        question.correctness = clampScore(parsed.correctness);
        question.score = clampScore(parsed.finalScore);
        question.feedback = parsed.feedback || "Good response.";

        await interview.save();

        return res.status(200).json({ feedback: question.feedback });

    } catch (error) {
        console.error("submitAnswer Error:", error);
        return res.status(500).json({ message: "Failed to evaluate your answer. Please try again." });
    }
};

export const finishInterview = async (req, res) => {
    try {
        const { interviewId } = req.body ?? {};
        if (!isObjectIdString(interviewId)) {
            return res.status(400).json({ message: "Invalid interview id" });
        }
        const interview = await Interview.findOne({ _id: interviewId, userId: req.userId });

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
            finalScore: interview.finalScore,
            confidence: Number(avgConfidence.toFixed(1)),
            communication: Number(avgCommunication.toFixed(1)),
            correctness: Number(avgCorrectness.toFixed(1)),
            questionWiseScore: interview.questions.map((q) => ({
                question: q.question,
                score: Number((q.score || 0).toFixed(1)),
                feedback: q.feedback || "",
                confidence: Number((q.confidence || 0).toFixed(1)),
                communication: Number((q.communication || 0).toFixed(1)),
                correctness: Number((q.correctness || 0).toFixed(1)),
            })),
        });

    } catch (error) {
        console.error("finishInterview Error:", error);
        return res.status(500).json({ message: "Failed to finish the interview. Please try again." });
    }
};

export const getMyInterviews = async (req, res) => {
    try {
        const interview = await Interview.find({ userId: req.userId })
            .sort({ createdAt: -1 })
            .select("role experience mode finalScore status createdAt");
        return res.status(200).json(interview)
    } catch (error) {
        return res.status(500).json({ message: `Failed to find current interview: ${error}` });
    }
}

export const getInterviewReport = async (req, res) => {
    try {
        if (!isObjectIdString(req.params.id)) {
            return res.status(404).json({ message: "Interview not Found" })
        }
        const interview = await Interview.findOne({ _id: req.params.id, userId: req.userId })

        if (!interview) {
            return res.status(404).json({ message: "Interview not Found" })
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
            
            finalScore: Number((interview.finalScore || 0).toFixed(1)),
            confidence: Number(avgConfidence.toFixed(1)),
            communication: Number(avgCommunication.toFixed(1)),
            correctness: Number(avgCorrectness.toFixed(1)),
            questionWiseScore: interview.questions.map((q) => ({
                question: q.question,
                answer: q.answer || "",
                score: Number((q.score || 0).toFixed(1)),
                feedback: q.feedback || "",
                confidence: Number((q.confidence || 0).toFixed(1)),
                communication: Number((q.communication || 0).toFixed(1)),
                correctness: Number((q.correctness || 0).toFixed(1)),
            }))
        })

    } catch (error) {
        console.error("getInterviewReport Error:", error);
        return res.status(500).json({ message: "Failed to load the interview report." });
    }
}
