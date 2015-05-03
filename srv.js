var later       = require('later');
var express     = require('express');
var Redis = require('ioredis');
var Promise     = require('bluebird');
var querystring = require('querystring');
var co          = require('co');
var moment      = require('moment');
var debug       = require('debug')('witty');
var request     = Promise.promisify(require('request'));

var app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

var server = app.listen(3000, () => {

  var host = server.address().address;
  var port = server.address().port;

  console.log('Witty listening at http://%s:%s', host, port);
});

var redis = new Redis(process.env.REDIS_CONNECTION);

var retrieveSched = later.parse.recur().every(1).minute();

var retrieveRecentThreads = function(argBlob) {

  var token = process.env.QUIP_TOKEN;
  let qs = querystring.stringify(argBlob);

  return request({
    uri: `https://platform.quip.com/1/threads/recent?${ qs }`,
    headers: {
      Authorization: `Bearer ${ token }`
    },
    json: true
  })
};

var retrieveSample = function*(max_updated_usec) {

  max_updated_usec = Date.now() * 1000 || max_updated_usec;

  let [response, data] = yield retrieveRecentThreads({
    max_updated_usec: max_updated_usec,
    count: 5
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    debug(`error occurred retrieving sample from ${ max_updated_usec }`);
    debug(data);
  }

  let sampleThreads = Object.keys(data);
  let nearestSecond = Math.floor(max_updated_usec / 1000 / 1000);
  let nearestMinuteBucket = Math.floor(nearestSecond / 60) % 60;
  let bucketKey = `sample:${ nearestMinuteBucket }`;

  debug(`retrieved sample at ${ moment.unix(nearestSecond).format() }, bucketed at ${ nearestMinuteBucket } (${ sampleThreads.join(', ') })`);

  yield redis.pipeline().del(bucketKey).sadd(bucketKey, sampleThreads).exec();
};

var analyzeSamples = function*() {

  let mapping = [];
  for (let minute = 0; minute < 60; minute++) {
    let sample = yield redis.smembers(`sample:${ minute }`);
    sample.forEach((thread) => {
      if (!mapping[thread]) mapping[thread] = 0;
      mapping[thread] += 1;
    });
  }

  debug(mapping);
};

var refreshData = function() {

  debug('refreshing data');

  co(function*() {
    yield retrieveSample();
    yield analyzeSamples();
  }).then((map) => {

  }).catch((err) => {
    console.log(err.stack);
  });

};

later.setInterval(refreshData, retrieveSched);
refreshData();
