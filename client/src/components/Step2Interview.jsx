import maleVedio from '../assets/male-ai.mp4';
import femaleVedio from '../assets/female-ai.mp4';
import Timer from './Timer';
import { motion } from "motion/react";
import { FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ServerUrl } from '../App';
import { BsArrowRight } from 'react-icons/bs';

function Step2Interview({ interviewData, onFinish }) {
  const { interviewId, questions, userName } = interviewData;
  const [isIntroPhase, setIntroPhase] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const recognitionRef = useRef(null);
  const [isAIPlaying, setIsAIPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [timeLeft, setTimeLeft] = useState(questions[0]?.timeLimit || 60);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [voiceGender, setVoiceGender] = useState("female");
  const [subtitle, setSubtitle] = useState("");

  const vedioRef = useRef(null);
  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex + 1 >= questions.length;
  const isMicOnRef = useRef(isMicOn);
  useEffect(() => {
    isMicOnRef.current = isMicOn;
  }, [isMicOn]);

  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;

      const femaleVoice = voices.find(v =>
        v.name.toLowerCase().includes("zira") ||
        v.name.toLowerCase().includes("samantha") ||
        v.name.toLowerCase().includes("female")
      );

      if (femaleVoice) {
        setSelectedVoice(femaleVoice);
        setVoiceGender("female");
        return;
      }

      const maleVoice = voices.find(v =>
        v.name.toLowerCase().includes("david") ||
        v.name.toLowerCase().includes("mark") ||
        v.name.toLowerCase().includes("male")
      );

      if (maleVoice) {
        setSelectedVoice(maleVoice);
        setVoiceGender("male");
        return;
      }

      const looksMale = /\b(male|man|guy)\b/i.test(fallback.name);
      setSelectedVoice(fallback);
      setVoiceGender(looksMale ? "male" : "female");
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const vedioSource = voiceGender === "male" ? maleVedio : femaleVedio;


  const speakText = (text, { restartMic = true } = {}) => {
    return new Promise((resolve) => {
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(safetyTimer);
        if (vedioRef.current) {
          vedioRef.current.pause();
          vedioRef.current.currentTime = 0;
        }
        setIsAIPlaying(false);
        if (restartMic && isMicOnRef.current) {
          startMic();
        }
        setSubtitle("");
        resolve();
      };

      let finished = false;

      if (!window.speechSynthesis || !selectedVoice) {
        finish();
        return;
      }
      window.speechSynthesis.cancel();

      const humanText = text.replace(/,/g, ", ...").replace(/\./g, ". ...");
      const utterance = new SpeechSynthesisUtterance(humanText);
      utterance.voice = selectedVoice;
      utterance.rate = 0.92;
      utterance.pitch = 1.05;
      utterance.volume = 1.05;

    
      const estimatedMs = Math.max(4000, humanText.length * 90);
      const safetyTimer = setTimeout(finish, estimatedMs);

      utterance.onstart = () => {
        setIsAIPlaying(true);
        stopMic();
        vedioRef.current?.play().catch(() => {});
      };

      utterance.onend = () => setTimeout(finish, 300);
      utterance.onerror = () => finish();

      setSubtitle(text);
      window.speechSynthesis.speak(utterance);
    });
  };

  useEffect(() => {
    if (!selectedVoice) return;

    const runIntro = async () => {
      if (isIntroPhase) {
        await speakText(
          `Hi ${userName}, it's great to meet you today. I hope you're feeling confident and ready.`,
          { restartMic: false }
        );
        await speakText(
          "I will ask you a few questions based on the resume and role. Just answer them naturally, and take your time. Let's begin.",
          { restartMic: false }
        );
        setIntroPhase(false);
      } else if (currentQuestion) {
        await new Promise((r) => setTimeout(r, 800));
        await speakText(currentQuestion.question);
      }
    };

    runIntro();
    
  }, [selectedVoice, isIntroPhase, currentIndex]);
  useEffect(() => {
    if (isIntroPhase || !currentQuestion) return;

    setTimeLeft(currentQuestion.timeLimit || 60);

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isIntroPhase, currentIndex, currentQuestion]);

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      setAnswer((prev) => prev + " " + transcript);
    };

    recognitionRef.current = recognition;
  }, []);

  const startMic = () => {
    if (recognitionRef.current && !isAIPlaying) {
      try {
        recognitionRef.current.start();
      } catch {}
    }
  };

  const stopMic = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
  };

  const toggleMic = () => {
    if (isMicOn) {
      stopMic();
    } else {
      startMic();
    }
    setIsMicOn(!isMicOn);
  };

  const submitAnswer = async () => {
    if (isSubmitting) return;
    stopMic();
    setIsSubmitting(true);
    try {
      const result = await axios.post(
        ServerUrl + "/api/interview/submit-answer",
        {
          interviewId,
          questionIndex: currentIndex,
          answer,
          timeTaken: (currentQuestion.timeLimit || 60) - timeLeft,
        },
        { withCredentials: true }
      );
      setFeedback(result.data.feedback);
      setIsSubmitting(false);
      speakText(result.data.feedback, { restartMic: false });
    } catch (error) {
      console.error(error);
      setIsSubmitting(false);
    }
  };

  const handleNext = async () => {
    setAnswer('');
    setFeedback('');

    if (currentIndex + 1 >= questions.length) {
      finishInterview();
      return;
    }

    
    await speakText("Alright, let's move to the next question.", { restartMic: false });
    setCurrentIndex(currentIndex + 1);
   
  };

  const finishInterview = async () => {
    stopMic();
    setIsMicOn(false);
    setIsFinishing(true);
    try {
      const result = await axios.post(
        ServerUrl + "/api/interview/finish",
        { interviewId },
        { withCredentials: true }
      );
      console.log(result.data)
      onFinish(result.data);
    } catch (error) {
      console.error(error);
    } finally {
      setIsFinishing(false);
    }
  };

  useEffect(() => {
    if (isIntroPhase || !currentQuestion) return;

  
    if (timeLeft === 0 && !isSubmitting && !feedback) {
      submitAnswer();
    }

  }, [timeLeft]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current.abort();
      }
      window.speechSynthesis.cancel();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-100 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-5xl min-h-[80vh] bg-white rounded-3xl shadow-2xl border border-gray-200 flex flex-col lg:flex-row overflow-hidden">

        {/* Left Video / Controls Column */}
        <div className="w-full lg:w-[35%] bg-white flex flex-col items-center p-6 space-y-6 border-r border-gray-200">
          <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-xl">
            <video
              src={vedioSource}
              key={vedioSource}
              ref={vedioRef}
              muted
              playsInline
              preload="auto"
              className="w-full h-auto object-cover"
            />
          </div>

          {subtitle && (
            <div className="w-full max-w-md bg-gray-50 border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-gray-700 text-sm sm:text-base font-medium text-center leading-relaxed">
                {subtitle}
              </p>
            </div>
          )}

          <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-md p-6 space-y-5">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Interview Status</span>
              {isAIPlaying && (
                <span className="text-sm font-semibold text-emerald-600">
                  AI Speaking
                </span>
              )}
            </div>
            <div className="h-px bg-gray-200"></div>
            <div className="flex justify-center">
              <Timer timeLeft={timeLeft} totalTime={currentQuestion?.timeLimit} />
            </div>

            <div className="h-px bg-gray-200"></div>
            <div className="grid grid-cols-2 gap-6 text-center">
              <div>
                <span className="text-2xl font-bold text-emerald-600">{currentIndex + 1}</span>
                <p className="text-xs text-gray-400">Current Question</p>
              </div>
              <div>
                <span className="text-2xl font-bold text-emerald-600">{questions.length}</span>
                <p className="text-xs text-gray-400">Total Questions</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Content Section */}
        <div className="flex-1 flex flex-col p-4 sm:p-6 md:p-8 relative">
          <h2 className="text-xl sm:text-2xl font-bold text-emerald-600 mb-6">
            AI Smart Interview
          </h2>

          {!isIntroPhase && (
            <div className="relative mb-6 bg-gray-50 p-4 sm:p-6 rounded-2xl border border-gray-200 shadow-sm">
              <p className="text-xs sm:text-sm text-gray-400 mb-2">
                Question {currentIndex + 1} of {questions.length}
              </p>
              <div className="text-base sm:text-lg font-semibold text-gray-800 leading-relaxed">
                {currentQuestion?.question}
              </div>
            </div>
          )}

          <textarea
            placeholder="Type your answer here..."
            onChange={(e) => setAnswer(e.target.value)}
            value={answer}
            className="flex-1 bg-gray-100 p-4 sm:p-6 rounded-2xl resize-none outline-none border border-gray-200 focus:ring-2 focus:ring-emerald-500 transition text-gray-800 min-h-[150px]"
          />

          {!feedback ? (
            <div className="flex items-center gap-4 mt-6">
              <motion.button
                onClick={toggleMic}
                whileTap={{ scale: 0.9 }}
                className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full bg-black text-white shadow-lg shrink-0"
              >
                {isMicOn ? <FaMicrophone size={20} /> : <FaMicrophoneSlash size={20} />}
              </motion.button>

              <motion.button
                onClick={submitAnswer}
                disabled={isSubmitting}
                whileTap={{ scale: 0.95 }}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-500 text-white py-3 sm:py-4 rounded-2xl shadow-lg hover:opacity-90 transition font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Submitting..." : "Submit Answer"}
              </motion.button>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 bg-emerald-50 border border-emerald-200 p-5 rounded-2xl shadow-sm"
            >
              <p className="text-emerald-700 font-medium mb-4">{feedback}</p>
              <button
                onClick={handleNext}
                disabled={isFinishing}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 text-white py-3 rounded-xl shadow-md hover:opacity-90 transition flex items-center justify-center gap-1 font-semibold disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLastQuestion
                  ? (isFinishing ? "Submitting Interview..." : "Submit Interview")
                  : (
                    <>
                      Next Question <BsArrowRight size={18} />
                    </>
                  )}
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Step2Interview;
