import express from "express"
import http from "http"
import mongoose from "mongoose"
import dotenv from "dotenv"
import volunteerAuthRouter from "../routes/auth.volunteer.routes.js";
import userAuthRouter from "../routes/auth.user.routes.js";
import cors from "cors"
import alertRouter from "../routes/alert.routes.js";
import volunteerRouter from "../routes/volunteer.routes.js";
import { expireStaleActiveAlerts } from "../libs/alertLifecycle.js";
import { emitUserAlertRefresh, emitVolunteerAlertsRefresh, initSocketServer } from "../libs/socket.js";
import Alert from "../model/alert.model.js";
import Volunteer from "../model/volunteer.model.js";

dotenv.config();
const app = express();
const ALERT_EXPIRY_JOB_INTERVAL_MS = 60 * 60 * 1000;

const ensureGeoIndexes = async () => {
    try {
        await Promise.all([
            Alert.createIndexes(),
            Volunteer.createIndexes(),
        ]);
        console.log("[indexes] ensured geo indexes for alerts and volunteers");
    } catch (error) {
        console.log("error while ensuring geo indexes ", error);
    }
};

const runAlertExpiryJob = async () => {
    try {
        const result = await expireStaleActiveAlerts();
        if (result.expiredCount > 0) {
            console.log(`[alert-expiry] Auto-cancelled ${result.expiredCount} stale alerts.`);

            (result.userIds || []).forEach((userId) => {
                emitUserAlertRefresh(userId, { reason: "expired" });
            });

            if ((result.volunteerIds || []).length > 0) {
                emitVolunteerAlertsRefresh({ reason: "expired" }, result.volunteerIds || []);
            }
        }
    } catch (error) {
        console.log("error while running alert expiry job ", error);
    }
};

app.use(cors({origin:'*'}))

app.use(express.json({limit:'1mb'}))


app.use('/api/volunteer/auth',volunteerAuthRouter);
app.use('/api/auth',userAuthRouter);

app.use('/api/volunteer',volunteerRouter);
app.use('/api/alert',alertRouter);
app.use('/api',()=>{});

mongoose.connect(process.env.DB_URI)
.then(async ()=>{
    await ensureGeoIndexes();

    const httpServer = http.createServer(app);
    initSocketServer(httpServer);

    httpServer.listen(process.env.PORT,()=>{
        console.log(`app is running on http://localhost:${process.env.PORT}`);
    });

    runAlertExpiryJob();
    setInterval(runAlertExpiryJob, ALERT_EXPIRY_JOB_INTERVAL_MS);

})
.catch((err)=>{
    console.log("error while connect to mongodb ",err);
})
