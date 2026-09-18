import mongoose from "mongoose";
import dns from "dns";


dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const connectDb = async () => {

    try {
        await mongoose.connect(process.env.MONGODB);
        console.log("DataBase Connected");
    } catch (error) {
        console.log(`DataBase Error ${error}`);
    }
}

export default connectDb