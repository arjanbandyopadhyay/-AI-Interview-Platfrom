import "dotenv/config"          // must be the first import: loads .env before the other modules read process.env
import connectDb from "./config/connectDb.js"
import app from "./app.js"

const PORT=process.env.PORT || 6000
app.listen(PORT,()=>{
    console.log(`server running on port ${PORT}`)
    connectDb();
})
