const { PDFDocument } = require('pdf-lib');
const { google } = require('googleapis');
const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const https = require('https');
const crypto = require('crypto');
const { Readable } = require('stream');

app.use(bodyParser.json());

require('dotenv').config();

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.private_key.replace(/\\n/g, '\n')
  },
  scopes: ['https://www.googleapis.com/auth/drive']
});

const drive = google.drive({ version: 'v3', auth });

async function downloadFilesFromFolder(folderId, billType) {
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and name starts with '${billType}' and mimeType='application/pdf'`,
      fields: 'files(id, name, createdTime)'
    });

    if (!res.data.files || res.data.files.length === 0) {
      console.log('No PDF files found in the specified folder.');
      return null;
    }

    const pdfDoc = await PDFDocument.create();
    const sortedFiles = res.data.files.sort((a, b) => a.name.localeCompare(b.name));

    const firstFileCreatedTime = new Date(sortedFiles[0].createdTime);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formattedDate = monthNames[firstFileCreatedTime.getMonth()] + firstFileCreatedTime.getFullYear();



    const firstFileName = sortedFiles[0].name.split(' ')[0];
    const lastFileName = sortedFiles[sortedFiles.length - 1].name.split(' ')[0];

    const pdfName = `${firstFileName}-${lastFileName} [${sortedFiles.length}] ${formattedDate}.pdf`;



    for (const file of res.data.files) {
      const response = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'arraybuffer' } // Request array buffer type
      );

      const pdfBytes = response.data; // Get the array buffer directly

      const externalPdfDoc = await PDFDocument.load(pdfBytes);
      const copiedPages = await pdfDoc.copyPages(externalPdfDoc, externalPdfDoc.getPageIndices());
      copiedPages.forEach(page => pdfDoc.addPage(page));
    }

    return [pdfDoc, pdfName];
  } catch (error) {
    console.error('Error downloading files:', error);
    return null;
  }
}

async function sendPDFToGroup(pdfDoc, botToken, chatId, fileName) {
  try {
    const pdfBytes = await pdfDoc.save();

    const boundary = '-----' + crypto.randomBytes(16).toString('hex');
    const data = `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
      `${chatId}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="document"; filename=${fileName}\r\n` +
      `Content-Type: application/pdf\r\n\r\n`;

    const options = {
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendDocument`,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      }
    };

    const req = https.request(options, res => {
      let responseData = '';
      res.on('data', chunk => {
        responseData += chunk;
      });
      res.on('end', () => {
        console.log('Response:', responseData);
      });
    });

    req.on('error', error => {
      console.error('Error sending PDF:', error);
    });

    req.write(data);
    req.write(pdfBytes);
    req.end(`\r\n--${boundary}--\r\n`);
    console.log('PDF sent to Telegram group');
  } catch (error) {
    console.error('Error sending PDF:', error);
  }
}

async function main(SP, botToken, chatId) {
  const folderId = process.env.FOLDERID;
  const pdfDocs = await downloadFilesFromFolder(folderId, SP);
  const pdfDoc = pdfDocs[0];
  const fileName = pdfDocs[1];
  console.log("fileName");
  if (pdfDoc) {
    console.log(fileName);
    await sendPDFToGroup(pdfDoc, botToken, chatId,fileName);
    const uploadFolderId = (fileName[0] == "P") ? "1svKwt6HpogrwQwxMegoS-QQ1PB852qd1" : "1BRVVV76DFjN3vv8Giymlt8rl0IO9Kmf0";
    await uploadFileToFolder(pdfDoc, uploadFolderId, fileName);
    return "Success";
  } else {
    return "Failed";
  }
}

async function uploadFileToFolder(pdfDoc, folderId, fileName) {
  const fileMetadata = {
    name: fileName,
    parents: [folderId]
  };

  const pdfBytes = await pdfDoc.save(); // Save the PDF document to get its bytes
  const pdfStream = new Readable();
  pdfStream.push(pdfBytes);
  pdfStream.push(null); // Signal the end of the stream

  const media = {
    mimeType: 'application/pdf',
    body: pdfStream // Pass the readable stream as the body
  };

  try {
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id'
    });
    console.log('File uploaded to Sales subfolder successfully with ID:', response.data.id);
  } catch (error) {
    console.error('Error uploading file to Sales subfolder:', error.message);
  }
}




app.get('/pdf', async (req, res) => {
  const SP = req.query.SP;
  const botToken = process.env.BOT_TOKEN;
  const chatId = process.env.CHAT_ID;

  try {
    const result = await main(SP, botToken, chatId);
    res.send(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
