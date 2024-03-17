const { createServer } = require('http');
const crypto = require('crypto');
const fs = require('fs');

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/encrypt') {
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
