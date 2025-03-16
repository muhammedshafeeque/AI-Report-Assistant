import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import routes from "./Routes/index.js";
import morgan from "morgan";
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();
const app = express();

// Configure CORS with specific options
app.use(cors({
  origin: '*', // Allow all origins during development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use("/api", routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Add a polyfill for the nullish coalescing assignment operator
if (!Object.prototype.hasOwnProperty.call(Object, 'hasOwn')) {
  Object.defineProperty(Object, 'hasOwn', {
    value: function(object, property) {
      if (object == null) {
        throw new TypeError('Cannot convert undefined or null to object');
      }
      return Object.prototype.hasOwnProperty.call(Object(object), property);
    },
    configurable: true,
    writable: true
  });
}
