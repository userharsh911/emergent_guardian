import express from "express"
import mongoose from "mongoose"
import dotenv from "dotenv"
import volunteerAuthRouter from "../routes/auth.volunteer.routes.js";
import userAuthRouter from "../routes/auth.user.routes.js";
import cors from "cors"

dotenv.config();
const app = express();
app.use(cors({origin:'*'}))

app.use(express.json({limit:'1mb'}))


app.use('/api/volunteer/auth',volunteerAuthRouter);
app.use('/api/auth',userAuthRouter);

app.use('/api/volunteer',()=>{})
app.use('/api/',()=>{})

mongoose.connect(process.env.DB_URI)
.then(()=>{
    app.listen(process.env.PORT,()=>{
        console.log(`app is running on http://localhost:${process.env.PORT}`);
    });

})
.catch((err)=>{
    console.log("error while connect to mongodb ",err);
})
