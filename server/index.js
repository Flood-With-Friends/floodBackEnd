const express = require('express');
const axios = require('axios');
const turf = require('@turf/turf');
const bodyParser = require('body-parser');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const config = require('../config.js');
const { insertUser, createReport, getReports } = require('../database/dbindex');
const { getRainfall, createAddress, formatWaypoints } = require('./APIhelpers');

cloudinary.config(config);
const PORT = process.env.PORT || 8080;


const app = express();

app.use(bodyParser.json());


const angularStaticDir = path.join(__dirname, '../../flood/dist/flood');

app.use(express.static(angularStaticDir));

let reportData;

app.post('/getMap', async (req, res) => {
  const directions = {};
  const bufferArr = [];
  const reports = await getReports();
 
  reports.forEach((report) => {
    if (report.latlng) {
      const arr = report.latlng.split(',');
      const point = turf.point([parseFloat(arr[1]), parseFloat(arr[0])]);
      const bufferedPoint = turf.buffer(point, 0.5, { units: 'miles' });
      bufferArr.push(bufferedPoint);
    }
  });

  //LEAVING lines below right now, just for reference. Will delete later.
  // const slimBuffer = bufferArr.splice(0, 15);
  // const point1 = turf.point([-90.078370, 29.976051]);
  // const bufferedPoint1 = turf.buffer(point1, 0.2, { units: 'miles' });
  // const point2 = turf.point([-90.072157, 29.971722]);
  // const bufferedPoint2 = turf.buffer(point2, 0.2, { units: 'miles' });

  // const obstacles = turf.featureCollection([bufferedPoint1, bufferedPoint2]);
  
  const obstacles = turf.featureCollection(bufferArr);

  // console.log(obstacles, 'this is the obstacles');

  // going to need to be the origin and desination lat/lng from the http req from front end,
  // with obstacles = sections that are flood reports
  const start = [parseFloat(req.body.mapReqInfo.origin.lng), parseFloat(req.body.mapReqInfo.origin.lat)];
  const end = [parseFloat(req.body.mapReqInfo.destination.lng), parseFloat(req.body.mapReqInfo.destination.lat)];
  const options = {
    obstacles,
  };

  const route = await turf.shortestPath(start, end, options);

  const routeCoordsArray = route.geometry.coordinates;
  // console.log(routeCoordsArray, 'this is the coords array');

  //format coordinates from routeCoordsArray to be in appropriate form for snapToRoads API below
  const allCoords = await formatWaypoints(routeCoordsArray);
  
  // snap the coords from allCoords to roads, using google's snapToRoads API,
  // take returned lat/lng of origin, destin from that API req and send it to google agm directions
  // send the return of that to front end to render on the client side map

  

  await axios.get(`https://roads.googleapis.com/v1/snapToRoads?path=${allCoords}&interpolate=false&key=AIzaSyDCQchp8XgMTPdeHQG_4EJ8ytTv7bWPP3c`)
    .then((response) => {
      //I don't think we'll need these next two lines that set props of origin and destination in response, but leaving them for now, just in case
      // directions.origin = { lat: response.data.snappedPoints[0].location.latitude, lng: response.data.snappedPoints[0].location.longitude };
      // directions.destination = { lat: response.data.snappedPoints[response.data.snappedPoints.length - 1].location.latitude, lng: response.data.snappedPoints[response.data.snappedPoints.length - 1].location.longitude };
      const mapped = response.data.snappedPoints.slice(1, response.data.snappedPoints.length - 1).map((points) => ({ location: { lat: points.location.latitude, lng: points.location.longitude } }));
      // console.log('this is mapped', mapped);
      directions.waypoints = mapped;
      res.status(201).send(directions);
    });


  // The code below will also work, but it seems to give less accurate results.
  //Leaving the code for now just in case we need to use it after we get elevation into the maps, too.

  // // //add origin prop in directions that takes first lat/lng from routeCoordsArray as beginning point
  // directions.origin = { lat: routeCoordsArray[0][1], lng: routeCoordsArray[0][0] };
  // // //add destination prop in directions that takes last lat/lng from routeCoordsArray as ending point
  // directions.destination = { lat: routeCoordsArray[routeCoordsArray.length - 1][1], lng: routeCoordsArray[routeCoordsArray.length - 1][0] };
  // // //chop off first and last lat/lng combos from routeCoordsArray so that only the middle points will be used as waypoints in directions variable
  // routeCoordsArray.shift();
  // routeCoordsArray.pop();

  // // //loop through all remaining lat/lngs in routeCoordsArray and set them up as waypoints in the directions variable
  // const result = routeCoordsArray.map((coordPair) => ({ location: { lat: coordPair[1], lng: coordPair[0] } }));
  // const points = [result[4], result[5], result[6], result[7], result[8], result[9]];
  // directions.waypoints = result;
  // // directions.waypoints = points;

  // // send back directions object with origin, desintation, and waypoints formatted for use with agm
  // res.status(201).send(directions);
});

app.get('/rainfall', (req, res) => getRainfall()
  .then((rainTotal) => {
    res.json(rainTotal);
  })
  .catch((err) => {
    console.log(err);
    res.status(500);
  }));

app.post('/submitReport', async (req, res) => {
  let returnedAddress;

  // user is using current location
  // find the address of the user's location
  if (!req.body.report.location) {
    returnedAddress = await createAddress(req.body.report.latLng);
  }

  // user has image
  // get a url string from cloudinary for report img
  // send that report into the database
  if (req.body.report.img) {
    cloudinary.uploader.upload(req.body.report.img, (error, result) => result)
      .then((imgAssets) => {
        reportData = {
          desc: req.body.report.desc,
          latLng: req.body.report.latLng,
          img: imgAssets.secure_url,
          physicalAddress: returnedAddress || req.body.location,
        };
      })
      .then(() => {
        createReport(reportData);
      })
      .then(() => {
        res.status(201).send('got ya report...Allen');
      });
  } else {
    // user does not have image
    reportData = {
      desc: req.body.report.desc,
      latLng: req.body.report.latLng,
      img: null,
      physicalAddress: returnedAddress || req.body.location,
    };
    await createReport(reportData);
    res.status(201).send('got ya report...Allen');
  }
});

app.get('/addUser', (req, res) => {
  insertUser()
    .then((results) => {
      console.log(results);
      res.send(200);
    })
    .catch((error) => {
      console.log(error);
      res.send(500);
    });
});

// GET req from frontend when user loads any page that renders a map.
// This fn gets all flood reports from db, and returns them to the user.
app.get('/floodReports', (req, res) => {
  getReports()
    .then((reports) => {
      console.log(reports);
      res.send(reports);
    })
    .catch(() => {
      res.send(500);
    });
  // const reports = await getReports();
  // res.status(201).json(reports.rows);
});

app.get('*', (req, res) => {
  res.status(200).sendFile(path.join(__dirname, '../../flood/dist/flood'));
});

app.listen(PORT, () => {
  console.log('Floodbuddies be listening on: 8080');
});
