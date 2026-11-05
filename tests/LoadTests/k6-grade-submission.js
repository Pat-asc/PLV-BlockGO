import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';

const apiUrl = (__ENV.API_URL || 'http://localhost:8080/api').replace(/\/$/, '');
const targetUsers = Number.parseInt(__ENV.TARGET_USERS || '500', 10);
const holdDuration = __ENV.HOLD_DURATION || '3m';
const studentPrefix = __ENV.STUDENT_ID_PREFIX || 'LOAD';
const studentCount = Number.parseInt(__ENV.STUDENT_COUNT || '1000', 10);

if (!Number.isInteger(targetUsers) || targetUsers < 1) {
  throw new Error('TARGET_USERS must be a positive integer.');
}

if (!Number.isInteger(studentCount) || studentCount < 1) {
  throw new Error('STUDENT_COUNT must be a positive integer.');
}

export const options = {
  stages: [
    { duration: '30s', target: targetUsers },
    { duration: holdDuration, target: targetUsers },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<5000'],
  },
};

export function setup() {
  const response = http.post(`${apiUrl}/login`, JSON.stringify({
    username: __ENV.LOAD_TEST_EMAIL,
    password: __ENV.LOAD_TEST_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });

  const authenticated = check(response, {
    'load-test account authenticated': (res) => res.status === 200 && Boolean(res.json('token')),
  });

  if (!authenticated) {
    fail(`Load-test login failed with HTTP ${response.status}.`);
  }

  return { token: response.json('token') };
}

export default function ({ token }) {
  const sequence = exec.scenario.iterationInTest;
  const studentIndex = sequence % studentCount;
  const uniqueId = `LOAD-${Date.now()}-${exec.vu.idInTest}-${sequence}`;
  const studentNo = `${studentPrefix}${String(studentIndex + 1).padStart(6, '0')}`;
  const payload = {
    id: uniqueId,
    student_id: studentNo,
    student_no: studentNo,
    student_name: `Load Test Student ${studentIndex + 1}`,
    section: 'LOAD-TEST',
    year_level: '1',
    course: 'BSIT',
    program: 'BSIT',
    subject_code: 'LOAD101',
    subject_title: 'Blockchain Load Test',
    units: 3,
    grade: '1.50',
    semester: 'FIRST',
    school_year: 'LOAD-TEST',
    term: 'midterm',
    university: 'PLV',
  };

  const response = http.post(`${apiUrl}/issue-grade`, JSON.stringify(payload), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    tags: { operation: 'IssueGrade' },
  });

  check(response, {
    'grade transaction committed': (res) => res.status === 201,
  });
  sleep(0.1);
}
