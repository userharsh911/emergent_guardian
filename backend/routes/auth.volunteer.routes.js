import express from "express"
import { applyVolunteerController, getVolunteerController, loginVolunteerController } from "../controller/auth.volunteer.controller.js";
import { volunteerProtectedRoute } from "../middleware/protectedRoute.js";

const volunteerAuthRouter = express.Router();

volunteerAuthRouter.post("/apply",applyVolunteerController);
volunteerAuthRouter.post("/login",loginVolunteerController);
volunteerAuthRouter.get("/:token",volunteerProtectedRoute,getVolunteerController);

export default volunteerAuthRouter;