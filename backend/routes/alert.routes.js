import express from "express"
import {
	createAlertController,
	getAlertStatusController,
	getVolunteerNearbyAlertsController,
	volunteerSelectAlertController,
} from "../controller/alert.controller.js";
import { userProtectedRoute, volunteerProtectedRoute } from "../middleware/protectedRoute.js";

const alertRouter = express.Router();

alertRouter.get('/volunteer/active/:token', volunteerProtectedRoute, getVolunteerNearbyAlertsController);
alertRouter.post('/volunteer/select/:token', volunteerProtectedRoute, volunteerSelectAlertController);

alertRouter.post('/status/:alertId/:token', userProtectedRoute, getAlertStatusController);
alertRouter.post('/status/:alertId', userProtectedRoute, getAlertStatusController);

alertRouter.post('/create/:token', userProtectedRoute, createAlertController);
alertRouter.post('/create', userProtectedRoute, createAlertController);

export default alertRouter