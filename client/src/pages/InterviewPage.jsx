import { lazy, Suspense, useEffect, useState } from "react"
import Step1SetUp from '../components/Step1SetUp'
import Step2Interview from '../components/Step2Interview'

// The report (charts) is only needed once the interview is over. It is downloaded in the background
// while the user is answering questions, so it is ready by the time they finish.
const loadReport = () => import('../components/Step3Report')
const Step3Report = lazy(loadReport)




function InterviewPage() {
    const [step,setStep]=useState(1)
    const [interviewData,setInterviewData]=useState(null)
    useEffect(()=>{ if(step===2) loadReport() },[step])
  return (
    <div className="min-h-screen bg-gray-50">
        {step===1 &&(
            <Step1SetUp onStart={(data)=>{setInterviewData(data)
                setStep(2)
            }} />
        )}
        
        {step===2 &&(
            <Step2Interview interviewData={interviewData}
            onFinish={(report)=>{setInterviewData(report)
                setStep(3)
            }}
            />
        )}
        {step===3 &&(
            <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Loading report...</div>}>
                <Step3Report report={interviewData} />
            </Suspense>
        )}
    
    </div>
  )
}

export default InterviewPage