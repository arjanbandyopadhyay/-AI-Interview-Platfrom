import { Route, Routes } from "react-router-dom"
import Home from './pages/Home'
import Auth from './pages/auth'
import { useEffect } from "react"
import axios from "axios"
import { useDispatch } from "react-redux"
import { setUserData } from "./redux/userSlice"
import InterviewPage from "./pages/InterviewPage"
import InterviewHistory from "./pages/interviewHistory"
import InterviewReport from "./pages/InterviewReport"
import Pricing from "./pages/Pricing"

export const ServerUrl = "https://ai-interview-platfrom.onrender.com"

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
    <Routes>
      <Route path='/' element={<Home />} />
      <Route path='/auth' element={<Auth />} />
      <Route path='/interview'element={<InterviewPage />}/>
       <Route path='/History'element={<InterviewHistory/>}/>
        <Route path='/report/:id'element={<InterviewReport />}/>
        <Route path='/Pricing' element={<Pricing/>} />
    </Routes>
   
  
  )
}

export default App
