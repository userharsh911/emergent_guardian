import express from "express"
import { volunteerSaveTokenController, volunteerUpdateLocationController } from "../controller/volunteer.controller.js";
import { volunteerProtectedRoute } from "../middleware/protectedRoute.js";

const volunteerRouter = express.Router();

volunteerRouter.post('/save-token/:token', volunteerProtectedRoute, volunteerSaveTokenController)
volunteerRouter.post('/update-location/:token', volunteerProtectedRoute, volunteerUpdateLocationController)

export default volunteerRouter;