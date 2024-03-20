	const AWS = require('aws-sdk');

	const { PDFDocument } = require('pdf-lib');
	const { google } = require('googleapis');
	const https = require('https');
	const express = require('express');
	const bodyParser = require('body-parser');
	const { createServer } = require('http');
	const crypto = require('crypto');
	const path = require('path');

	const app = express();
	app.use(bodyParser.json());

	require('dotenv').config();

	const s3 = new AWS.S3();

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
				return;
			}

			const pdfDoc = await PDFDocument.create();

			const sortedFiles = res.data.files.sort((a, b) => a.name.localeCompare(b.name));

			const firstFileCreatedTime = new Date(sortedFiles[0].createdTime);
			const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
				"Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
			const formattedDate = monthNames[firstFileCreatedTime.getMonth()] + firstFileCreatedTime.getFullYear();

			const firstFileName = sortedFiles[0].name.split(' ')[0];
			const lastFileName = sortedFiles[sortedFiles.length - 1].name.split(' ')[0];

			const pdfPath = `${firstFileName}-${lastFileName} [${sortedFiles.length}] ${formattedDate}.pdf`;

			for (const file of sortedFiles) {
				const response = await drive.files.get(
					{ fileId: file.id, alt: 'media' },
					{ responseType: 'stream' }
				);
				const pdfBytes = await new Promise((resolve, reject) => {
					const chunks = [];
					response.data.on('data', chunk => chunks.push(chunk));
					response.data.on('end', () => resolve(Buffer.concat(chunks)));
					response.data.on('error', reject);
				});

				const externalPdfDoc = await PDFDocument.load(pdfBytes);
				const copiedPages = await pdfDoc.copyPages(externalPdfDoc, externalPdfDoc.getPageIndices());
				copiedPages.forEach(page => pdfDoc.addPage(page));
			}

			const combinedPdfBytes = await pdfDoc.save();
			return combinedPdfBytes;
		} catch (error) {
			console.error('Error downloading files:', error);
			throw error;
		}
	}

	async function uploadFileToFolder(fileData, fileName) {
		const params = {
			Bucket: 'cyclic-clever-goat-sweatsuit-ap-northeast-1',
			Key: fileName,
			Body: fileData
		};
		try {
			const data = await s3.upload(params).promise();
			console.log('File uploaded to S3:', data.Location);
			return data.Location;
		} catch (error) {
			console.error('Error uploading file to S3:', error);
			throw error;
		}
	}

	async function sendPDFToGroup(pdfData, botToken, chatId) {
		try {
			const boundary = '-----' + Date.now();
			const data = `--${boundary}\r\n` +
				`Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
				`${chatId}\r\n` +
				`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="document"; filename="file.pdf"\r\n` +
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
			req.write(pdfData);
			req.end(`\r\n--${boundary}--\r\n`);
			console.log('PDF sent to Telegram group');
		} catch (error) {
			console.error('Error sending PDF:', error);
			throw error;
		}
	}



	async function main(SP) {
	  const folderId = process.env.FOLDERID;
	  const pdfPath = await downloadFilesFromFolder(folderId, SP);

	  if (pdfPath) {
		const botToken = process.env.BOT_TOKEN;
		const chatId = process.env.CHAT_ID;

		const folderId = (pdfPath[0] == "P") ? "1svKwt6HpogrwQwxMegoS-QQ1PB852qd1" : "1BRVVV76DFjN3vv8Giymlt8rl0IO9Kmf0";

		const uploadPromise = uploadFileToFolder(pdfPath, folderId);
		const sendPromise = sendPDFToGroup(pdfPath, botToken, chatId);

		await Promise.all([uploadPromise, sendPromise]);

	   // fs.unlinkSync(pdfPath);

		return "Success"
	  }
	}



	const server = createServer(async (req, res) => {
	  if (req.method === 'GET' && req.url.startsWith('/pdf')) {
		const SP = req.url.split('=')[1];
		try {
		  const result = await main(SP);
		  res.writeHead(200, { 'Content-Type': 'text/plain' });
		  res.end(result);
		} catch (error) {
		  res.writeHead(500, { 'Content-Type': 'text/plain' });
		  res.end(error.message);
		}}

	  else if (req.method === 'POST' && req.url === '/encrypt') {
		let body = '';
		req.on('data', chunk => {
		  body += chunk.toString();
		});

		req.on('end', () => {
		  try {
			const data = JSON.parse(body);
			const encryptedData = encryptWithRSA(data.text);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ encryptedData }));
		  } catch (error) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Invalid request' }));
		  }
		});
	  } else if (req.method === 'POST' && req.url === '/encrypt-by-key') {
		let body = '';
		req.on('data', chunk => {
		  body += chunk.toString();
		});

		req.on('end', () => {
		  try {
			const data = JSON.parse(body);
			const encryptedData = encryptBySymmetricKey(data.jsonData, data.decryptedSek);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ encryptedData }));
		  } catch (error) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Invalid request' }));
		  }
		});
	  } else if (req.method === 'POST' && req.url === '/decrypt-sek') {
		let body = '';
		req.on('data', chunk => {
		  body += chunk.toString();
		});

		req.on('end', () => {
		  try {
			const data = JSON.parse(body);
			const decryptedSek = decryptSekWithAppKey(data.encryptedSek, data.base64AppKey);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ decryptedSek }));
		  } catch (error) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Invalid request' }));
		  }
		});
	  } else if (req.method === 'GET' && req.url === '/') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('Hello, World!');
		} else {
		  res.writeHead(404, { 'Content-Type': 'application/json' });
		  res.end(JSON.stringify({ error: 'Not Found' }));
		}
		});

		function encryptWithRSA(data) {
		const publicKeyPath = 'public_key.pem';

		// Load the public key from the given file path
		const pemData = fs.readFileSync(publicKeyPath);
		const publicKey = crypto.createPublicKey(pemData);

		const encryptedData = crypto.publicEncrypt({
		  key: publicKey,
		  padding: crypto.constants.RSA_PKCS1_PADDING
		}, Buffer.from(data, 'utf-8'));

		return encryptedData.toString('base64');
		}

		function encryptBySymmetricKey(jsonData, decryptedSek) {
		const sekByte = Buffer.from(decryptedSek, 'base64');
		const aesKey = crypto.createCipheriv('aes-256-ecb', sekByte, '');
		let encryptedJson = aesKey.update(jsonData, 'utf-8', 'base64');
		encryptedJson += aesKey.final('base64');
		return encryptedJson;
		}

		function decryptSekWithAppKey(encryptedSek, base64AppKey) {
		const appKey = Buffer.from(base64AppKey, 'base64');
		const decipher = crypto.createDecipheriv('aes-256-ecb', appKey, '');
		let decryptedSek = decipher.update(encryptedSek, 'base64', 'utf-8');
		decryptedSek += decipher.final('utf-8');
		return decryptedSek;
		}

		const PORT = process.env.PORT || 3000;
		server.listen(PORT, () => {
		console.log(`Server running on port ${PORT}`);
		});


