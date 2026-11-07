import test from 'node:test'
import assert from 'node:assert/strict'
import { jobHash, jobShareUrl, jobIdFromHash, parseRoute, pageOfId } from '../src/jobLink.js'

const ROUTES = ['home', 'welfare', 'jobs', 'apply', 'calendar', 'news', 'about', 'rare']

test('공고 id 가 주소와 서로 오간다', () => {
  for (const id of ['306244', 'gojobs-307214', 'kead-12', 'manual-krict-1', 307214]) {
    assert.equal(jobIdFromHash(jobHash(id)), String(id))
  }
  assert.equal(jobHash('gojobs-307214'), '#/jobs/gojobs-307214')
})

test('특수 문자는 인코딩했다가 되돌린다', () => {
  assert.equal(jobIdFromHash(jobHash('a b/c')), 'a b/c')
  assert.equal(jobIdFromHash('#/jobs/%E0%A4%A'), '')
})

test('공유 주소는 사이트 주소 뒤에 해시를 붙인다', () => {
  assert.equal(jobShareUrl('https://modupum.kr', '/', 'kead-1'), 'https://modupum.kr/#/jobs/kead-1')
  assert.equal(jobShareUrl('https://modupum.kr', '', 'kead-1'), 'https://modupum.kr/#/jobs/kead-1')
})

test('일자리 목록 주소와 다른 주소는 공고 id 가 없다', () => {
  assert.equal(jobIdFromHash('#/jobs'), '')
  assert.equal(jobIdFromHash('#/jobs/'), '')
  assert.equal(jobIdFromHash('#/calendar'), '')
  assert.equal(jobIdFromHash(''), '')
})

test('경로를 나눈다', () => {
  assert.deepEqual(parseRoute('#/jobs/gojobs-1', ROUTES), { tab: 'jobs', jobId: 'gojobs-1' })
  assert.deepEqual(parseRoute('#/jobs', ROUTES), { tab: 'jobs', jobId: '' })
  assert.deepEqual(parseRoute('#/calendar', ROUTES), { tab: 'calendar', jobId: '' })
  assert.deepEqual(parseRoute('#/rare', ROUTES), { tab: 'rare', jobId: '' })
  assert.deepEqual(parseRoute('#/nothing', ROUTES), { tab: 'home', jobId: '' })
  assert.deepEqual(parseRoute('', ROUTES), { tab: 'home', jobId: '' })
})

test('공고가 몇 쪽에 있는지 센다', () => {
  const items = Array.from({ length: 25 }, (_, n) => ({ id: `x-${n}` }))
  assert.equal(pageOfId(items, 'x-0', 10), 1)
  assert.equal(pageOfId(items, 'x-9', 10), 1)
  assert.equal(pageOfId(items, 'x-10', 10), 2)
  assert.equal(pageOfId(items, 'x-24', 10), 3)
  assert.equal(pageOfId(items, 'nope', 10), 0)
})
