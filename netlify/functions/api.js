const serverless = require("serverless-http");
const app = require("../../index");

exports.handler = serverless(app, { binary: ["image/png"] });
