const fs = require('fs');
const path = require('path');
const https = require('https');

const outDir = path.join(__dirname, '..', 'public', 'images');
const images = [
  'wireless-headphones', 'classic-tshirt', 'running-shoes', 'smart-watch',
  'backpack', 'coffee-mug', 'desk-lamp', 'yoga-mat', 'bluetooth-speaker',
  'denim-jacket', 'water-bottle', 'notebook',
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of images) {
    const url = `https://picsum.photos/seed/${name}/400/400`;
    const dest = path.join(outDir, `${name}.jpg`);
    process.stdout.write(`Downloading ${name}.jpg... `);
    try {
      await download(url, dest);
      console.log('OK');
    } catch (err) {
      console.log('FAILED:', err.message);
    }
  }
}

main();
