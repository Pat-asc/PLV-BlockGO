const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '..', '..', 'client-app', 'Controllers', 'GradeController.cs');
const source = fs.readFileSync(controllerPath, 'utf8');
const bulkStart = source.indexOf('public async Task<IActionResult> BulkUploadGrades');
const bulkEnd = source.indexOf('public async Task<IActionResult> CorrectGrade', bulkStart);
const bulkUpload = source.slice(bulkStart, bulkEnd);

test('Draft bulk upload has no synchronous IPFS or Fabric dependency', () => {
    assert.ok(bulkStart >= 0 && bulkEnd > bulkStart, 'BulkUploadGrades method boundaries were not found');
    assert.doesNotMatch(bulkUpload, /_blockchainService|GetAllGradesAsync|UploadToIpfs|IpfsApiUrl|PostAsync\(/);
    assert.match(bulkUpload, /'Draft'/);
});

test('Draft bulk upload leaves explicit submission as a separate endpoint', () => {
    assert.doesNotMatch(bulkUpload, /SubmitSection\(/);
    assert.match(source, /public async Task<IActionResult> SubmitSection\(/);
    assert.match(source, /SET status = 'SubmittedToChairperson'/);
});
