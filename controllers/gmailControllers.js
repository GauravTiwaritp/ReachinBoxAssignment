/**
 * Gaurav Tiwari
 *  gauravtiwari282001@gmail.com
 *  6376013956
 * This file is used to define the gmailControllers.
 * The first part handles all the initialization and setup of the gmail controllers.
 * The second part handles the cron job to check for new emails and enqueue them.
 * The third part handles the categorization and ai response generation.
 * The fourth part handles the email sending.
 * The fifth part handles the reading of the email content.
 */

const axios = require("axios");
const { generateConfig } = require("../utils");
const nodemailer = require("nodemailer");
const CONSTANTS = require("../constant");
const { google } = require("googleapis");
const cron = require("node-cron");
const { Queue, Worker } = require("bullmq");
const Redis = require("ioredis");

const redisConfig = {
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null,
};
const redis = new Redis(redisConfig);

const emailStoredQueue = new Queue("emailStoredQueue", {
  connection: redisConfig,
});

const LAST_EMAIL_ID_KEY = "lastEmailId";

require("dotenv").config();

const { TextServiceClient } = require("@google-ai/generativelanguage").v1beta2;
const { GoogleAuth } = require("google-auth-library");
const MODEL_NAME = "models/text-bison-001";
const API_KEY = process.env.Key;
const client = new TextServiceClient({
  authClient: new GoogleAuth().fromAPIKey(API_KEY),
});
const oAuth2Client = new google.auth.OAuth2(
  process.env.client_id,
  process.env.client_secret,
  process.env.redirect_uri
);

oAuth2Client.setCredentials({
  refresh_token: process.env.refresh_token,
});

const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

/*

This function is used to enqueue the email to the emailStoredQueue.
It takes the payload as input and adds the payload to the emailStoredQueue.
we store the ai response in the reply field and the senderEmail in the senderEmail field.
*/

async function enqueueEmail(payload) {
  const { reply, senderEmail } = payload;
  if (payload) {
    await emailStoredQueue.add("processEmail", { reply, senderEmail });
  }
}
/*
This function is used to categorize the email content.
It takes the email content as input and uses the gemini ai model to categorize the email content.
It then returns the categorization.
*/

async function categorizeEmail(content, retryCount = 0) {
  const prompt = `Categorize the following email content into one of three categories: Interested, Not Interested, More Information. Respond with only the category.\n\nEmail: ${content}\n\nCategory:`;
  try {
    const response = await client.generateText({
      model: MODEL_NAME,
      prompt: {
        text: prompt,
      },
    });
    return response;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      if (retryCount < 5) {
        `Rate limit exceeded. Retrying in ${2 ** retryCount} seconds...`;
        await new Promise((res) => setTimeout(res, 2 ** retryCount * 1000));
        return categorizeEmail(content, retryCount + 1);
      } else {
        throw new Error("Rate limit exceeded. Maximum retries reached.");
      }
    } else {
      throw error;
    }
  }
}

/*
This function is used to generate the ai response.
It takes the category and message as input and uses the gemini ai model to generate the ai response.
It then returns the ai response.
*/

async function generateResponse(category, message, retryCount = 0) {
  let responsePrompt;
  switch (category) {
    case "Interested":
      responsePrompt = `content of the mail is -${message} and Generate a polite response for an interested email `;
      break;
    case "Not Interested":
      responsePrompt = `content of the mail is -${message} and Generate a polite response for a not interested email.`;
      break;
    case "More Information":
      responsePrompt = `content of the mail is -${message} andGenerate a polite response asking for more information.`;
      break;
    default:
      return "Error: Unknown category";
  }

  try {
    const response = await client.generateText({
      model: MODEL_NAME,
      prompt: {
        text: responsePrompt,
      },
    });
    return response;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      if (retryCount < 5) {
        console.log(
          `Rate limit exceeded. Retrying in ${2 ** retryCount} seconds...`
        );

        await new Promise((res) => setTimeout(res, 2 ** retryCount * 1000));
        return generateResponse(category, retryCount + 1);
      } else {
        throw new Error("Rate limit exceeded. Maximum retries reached.");
      }
    } else {
      throw error;
    }
  }
}

/*
This function is used to get the last unread email.
After reading each email we are setting it as the last read mail
Also we are markiong the email as read.
*/

async function getLastMail(req, res) {
  let data;
  try {
    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults: 1,
      q: `label:INBOX is:unread `,
    });

    const messages = response.data.messages;

    if (messages && messages.length > 0) {
      const message = messages[0];
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
      });
      const emailDate = new Date(parseInt(msg.data.internalDate));

      await gmail.users.messages.modify({
        userId: "me",
        id: message.id,
        resource: {
          removeLabelIds: ["UNREAD"],
        },
      });
      data = msg.data;
      return data;
    }
  } catch (error) {
    console.log(error);
    res.status(500).send("Error fetching email");
    return;
  }
}

/*
This function is used as a collection point for our categorise email and generate ai response functions.
it takes the last email keep the last email id in redis to make sure the last visited email is not processed again.
then it stores the ai reply in the reply field and the senderEmail in the senderEmail field.
which is then enqueued to the emailStoredQueue.
*/

async function checkAndEnqueueEmails() {
  let payload = {};
  try {
    const latestMail = await getLastMail();
    const headers = latestMail.payload.headers;
    const fromHeader = headers.find((header) => header.name === "From");
    const senderEmail = fromHeader ? fromHeader.value : "Unknown sender";
    if (latestMail) {
      const lastEmailId = await redis.get(LAST_EMAIL_ID_KEY);
      if (latestMail.id != lastEmailId) {
        const category = await categorizeEmail(latestMail.snippet);

        const response = await generateResponse(
          category[0].candidates[0].output,
          latestMail.snippet
        );
        payload = {
          reply: response[0].candidates[0].output,
          senderEmail: senderEmail,
        };
        await enqueueEmail({
          reply: response[0].candidates[0].output,
          senderEmail: senderEmail,
        });
        await redis.set(LAST_EMAIL_ID_KEY, latestMail.id);
        console.log("New email enqueued successfully");
      } else {
        console.log("No new email to process");
      }
    } else {
      console.log("No new email found");
    }
  } catch (error) {
    console.log(error);
  }
}

/**
 * This function is used to schedule the cron job to run every 5 minutes.
 * It calls the checkAndEnqueueEmails function to check for new emails and enqueue them.
 */

cron.schedule("*/5 * * * *", async () => {
  await checkAndEnqueueEmails();
});

/**
 * This function is used to read the email content of the email.
 * It takes the messageId as input and uses the messageId to read the email content.
 * It then returns the email content.
 */

async function readMail(req, res) {
  try {
    const url = `https://gmail.googleapis.com/gmail/v1/users/gauravtiwari282001@gmail.com/messages/${req.params.messageId}`;
    const { token } = await oAuth2Client.getAccessToken();
    const config = generateConfig(url, token);
    const response = await axios(config);

    let data = await response.data;

    res.json(data);
  } catch (error) {
    console.log(error);
    res.send(error);
  }
}

/*

This function is used to send emails to the sender of the email.
It takes the payload as input and extracts the email id from the senderEmail field.
It then uses the email id to send the email to the sender.
it uses emailSenderWorker to obtain the email id and ai response and sendEmail function to send the email.
*/

const sendEmail = async (payload) => {
  const emailRegex = /<([^>]+)>/;
  const matches = emailRegex.exec(payload.data.senderEmail);
  console.log("email id", payload.data.senderEmail);
  console.log(matches);
  payload.data.senderEmail = matches[1];
  console.log(payload.data.senderEmail);

  try {
    const { token } = await oAuth2Client.getAccessToken();
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: {
        ...CONSTANTS.auth,
        accessToken: token,
      },
    });
    const mailOptions = {
      ...CONSTANTS.mailOptions,
      to: payload.data.senderEmail,
      subject: "Email from ReachInBox",
      text: payload.data.reply,
    };
    const result = await transport.sendMail(mailOptions);
    return result;
  } catch (error) {
    console.log(error);
    return error;
  }
};

const emailSenderWorker = new Worker(
  "emailStoredQueue",
  async (job) => {
    sendEmail(job);
  },
  { connection: redis }
);

emailSenderWorker.on("completed", (job) => {
  console.log(`email send successfully`);
});

emailSenderWorker.on("failed", (job, err) => {
  console.log(`job has failed with ${err}`);
});

module.exports = {
  readMail,
  getLastMail,
};
