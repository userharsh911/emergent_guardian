import express from "express"
import { volunteerSaveTokenController, volunteerUpdateLocationController, volunteerUpdateProfileController } from "../controller/volunteer.controller.js";
import { volunteerProtectedRoute } from "../middleware/protectedRoute.js";

const volunteerRouter = express.Router();

volunteerRouter.post('/save-token/:token', volunteerProtectedRoute, volunteerSaveTokenController)
volunteerRouter.post('/update-location/:token', volunteerProtectedRoute, volunteerUpdateLocationController)
volunteerRouter.post('/update-profile/:token', volunteerProtectedRoute, volunteerUpdateProfileController)

export default volunteerRouter;