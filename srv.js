var later       = require('later');
var express     = require('express');
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

var retrieveSched = later.parse.text('every minute');
later.date.UTC();

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

var refreshData = function() {

  debug('refreshing data');

  function sleep(millis) {
    var deferredResult = Promise.defer();
    setTimeout(function() {
      deferredResult.resolve();
    }, millis);
    return deferredResult.promise;
  };

  co(function*() {

    let samples = [];

    let max_updated_usec = Date.now() * 1000;//1430143200 * 1000 * 1000;
    for (let i = 0; i < 30; i++, max_updated_usec -= (1000 * 1000 * 60 * 2)) {

      yield sleep(600);

      let [response, threads] = yield retrieveRecentThreads({
        max_updated_usec: max_updated_usec,
        count: 2
      });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        debug(`error occurred retrieving sample from ${ max_updated_usec }`);
        debug(threads);
      }

      debug(`retrieved sample from ${ moment(max_updated_usec / 1000).format() }`);

      samples.push(threads);
    }

    return samples;

  }).then((samples) => {

    return samples.reduce((map, sample) => {

      Object.keys(sample).forEach((key) => {
        if (!map[key]) map[key] = {
          count: 0,
          title: sample[key].thread ? sample[key].thread.title : 'no title available',
          updates: []
        };

        let updateTime = sample[key].thread.updated_usec;

        if (!map[key].updates.includes(updateTime)) {
          map[key].count += 1;
          map[key].updates.push(updateTime);
        }
      });

      return map;
    }, {});

  }).then((map) => {
    console.log(map);
  }).catch((err) => {
    console.log(err.stack);
  });

};

later.setInterval(refreshData, retrieveSched);
refreshData();
