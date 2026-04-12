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

// token route for logged-in users
alertRouter.post('/create/:token', userProtectedRoute, createAlertController);
// fallback route for guest users (as_guest id in body)
alertRouter.post('/create', userProtectedRoute, createAlertController);

export default alertRouter