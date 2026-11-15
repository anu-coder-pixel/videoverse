const path = require('path');
const serverVideos = require('../server/data/videos.js').MOCK_VIDEOS;
const clientPath = path.resolve(__dirname, '../client/src/data/mockData.js');
let clientContent = require('fs').readFileSync(clientPath, 'utf-8');
// Replace titles using regex for each id
serverVideos.forEach(v => {
  const id = v.id;
  const title = v.title.replace(/\\/g, '\\\\'); // escape backslashes
  const regex = new RegExp(`(\"id\":\s*\'${id}\'[^\}]*\"title\":\s*\")[^\"]*(\")`, 's');
  clientContent = clientContent.replace(regex, `$1${title}$2`);
});
require('fs').writeFileSync(clientPath, clientContent, 'utf-8');
console.log('Titles synchronized from server to client.');

