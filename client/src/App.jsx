import { Route, Routes } from "react-router-dom"
import Home from './pages/Home'
import { lazy, Suspense, useEffect } from "react"
import axios from "axios"
import { useDispatch } from "react-redux"
import { setUserData } from "./redux/userSlice"

// The landing page loads eagerly; every other page is a separate chunk that is downloaded when the user
// navigates to it, so first-time visitors do not pay for recharts, jsPDF, Firebase and the interview UI up front.
const Auth = lazy(() => import('./pages/auth'))
const InterviewPage = lazy(() => import("./pages/InterviewPage"))
const InterviewHistory = lazy(() => import("./pages/InterviewHistory"))
const InterviewReport = lazy(() => import("./pages/InterviewReport"))
const Pricing = lazy(() => import("./pages/Pricing"))

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>
)

export const ServerUrl = import.meta.env.VITE_API_URL || "https://ai-interview-platfrom.onrender.com"

function App() {
  const dispatch=useDispatch()
  useEffect(() => {
    const getUser = async () => {
      try {
        const result = await axios.get(`${ServerUrl}/api/user/current-user`, {
          withCredentials: true
        })
        dispatch(setUserData(result.data))
      } catch (error) {
        console.log(error)
        dispatch(setUserData(null))
        
      }
    }
    
    getUser()
  },[dispatch])

  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path='/' element={<Home />} />
      <Route path='/auth' element={<Auth />} />
      <Route path='/interview'element={<InterviewPage />}/>
       <Route path='/History'element={<InterviewHistory/>}/>
        <Route path='/report/:id'element={<InterviewReport />}/>
        <Route path='/Pricing' element={<Pricing/>} />
    </Routes>
    </Suspense>
   
  
  )
}

export default App
