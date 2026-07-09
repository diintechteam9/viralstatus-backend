const dotenv = require("dotenv");
dotenv.config();
const mongoose = require("mongoose");
const Campaign = require("./models/campaign");
const MobileUser = require("./models/MobileUser");

const CITY_COORDINATES = {
  'delhi': { lat: 28.6139, lng: 77.2090 },
  'mumbai': { lat: 19.0760, lng: 72.8777 },
  'bangalore': { lat: 12.9716, lng: 77.5946 },
  'hyderabad': { lat: 17.3850, lng: 78.4867 },
  'chennai': { lat: 13.0827, lng: 80.2707 },
  'kolkata': { lat: 22.5726, lng: 88.3639 },
  'pune': { lat: 18.5204, lng: 73.8567 },
  'ahmedabad': { lat: 23.0225, lng: 72.5714 },
  'jaipur': { lat: 26.9124, lng: 75.7873 },
  'lucknow': { lat: 26.8467, lng: 80.9462 },
  'noida': { lat: 28.5355, lng: 77.3910 },
  'gurugram': { lat: 28.4595, lng: 77.0266 },
  'surat': { lat: 21.1702, lng: 72.8311 },
  'chandigarh': { lat: 30.7333, lng: 76.7794 },
  'indore': { lat: 22.7196, lng: 75.8577 }
};

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected!");

    const campaign = await Campaign.findOne({});
    const userIds = campaign.userIds || [];
    console.log("Campaign userIds:", userIds);

    const objectIds = [];
    for (const id of userIds) {
      if (typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)) {
        objectIds.push(new mongoose.Types.ObjectId(id));
      }
    }

    const participantCount = await MobileUser.countDocuments({
      $or: [
        { googleId: { $in: userIds } },
        { _id: { $in: objectIds } }
      ]
    });
    console.log("Counted matching documents:", participantCount);

    const results = await MobileUser.aggregate([
      {
        $match: {
          $or: [
            { googleId: { $in: userIds } },
            { _id: { $in: objectIds } }
          ]
        }
      },
      {
        $project: {
          city: { $ifNull: [ "$locationAddress.city", "$city" ] },
          lat: "$location.latitude",
          lng: "$location.longitude"
        }
      },
      {
        $group: {
          _id: "$city",
          count: { $sum: 1 },
          lat: { $first: "$lat" },
          lng: { $first: "$lng" }
        }
      }
    ]);
    console.log("Pipeline results:", results);

    const cityCounts = {};
    for (const r of results) {
      let city = r._id;
      if (!city) continue;
      city = city.trim();
      if (!city) continue;

      const lowerCity = city.toLowerCase();
      let canonicalCity = city;
      let latLng = null;

      if (lowerCity.includes('delhi')) {
        canonicalCity = 'Delhi';
        latLng = CITY_COORDINATES['delhi'];
      } else if (lowerCity.includes('mumbai') || lowerCity.includes('bombay')) {
        canonicalCity = 'Mumbai';
        latLng = CITY_COORDINATES['mumbai'];
      } else if (lowerCity.includes('bangalore') || lowerCity.includes('bengaluru')) {
        canonicalCity = 'Bangalore';
        latLng = CITY_COORDINATES['bangalore'];
      } else if (lowerCity.includes('hyderabad')) {
        canonicalCity = 'Hyderabad';
        latLng = CITY_COORDINATES['hyderabad'];
      } else if (lowerCity.includes('chennai') || lowerCity.includes('madras')) {
        canonicalCity = 'Chennai';
        latLng = CITY_COORDINATES['chennai'];
      } else if (lowerCity.includes('kolkata') || lowerCity.includes('calcutta')) {
        canonicalCity = 'Kolkata';
        latLng = CITY_COORDINATES['kolkata'];
      } else if (lowerCity.includes('pune')) {
        canonicalCity = 'Pune';
        latLng = CITY_COORDINATES['pune'];
      } else if (lowerCity.includes('ahmedabad')) {
        canonicalCity = 'Ahmedabad';
        latLng = CITY_COORDINATES['ahmedabad'];
      } else if (lowerCity.includes('jaipur')) {
        canonicalCity = 'Jaipur';
        latLng = CITY_COORDINATES['jaipur'];
      } else if (lowerCity.includes('lucknow')) {
        canonicalCity = 'Lucknow';
        latLng = CITY_COORDINATES['lucknow'];
      } else if (lowerCity.includes('noida')) {
        canonicalCity = 'Noida';
        latLng = CITY_COORDINATES['noida'];
      } else if (lowerCity.includes('gurugram') || lowerCity.includes('gurgaon')) {
        canonicalCity = 'Gurugram';
        latLng = CITY_COORDINATES['gurugram'];
      } else if (lowerCity.includes('surat')) {
        canonicalCity = 'Surat';
        latLng = CITY_COORDINATES['surat'];
      } else if (lowerCity.includes('chandigarh')) {
        canonicalCity = 'Chandigarh';
        latLng = CITY_COORDINATES['chandigarh'];
      } else if (lowerCity.includes('indore')) {
        canonicalCity = 'Indore';
        latLng = CITY_COORDINATES['indore'];
      } else {
        canonicalCity = city.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        if (typeof r.lat === 'number' && typeof r.lng === 'number') {
          latLng = { lat: r.lat, lng: r.lng };
        }
      }

      if (!cityCounts[canonicalCity]) {
        cityCounts[canonicalCity] = {
          city: canonicalCity,
          count: 0,
          lat: latLng ? latLng.lat : null,
          lng: latLng ? latLng.lng : null
        };
      } else if (!cityCounts[canonicalCity].lat && latLng) {
        cityCounts[canonicalCity].lat = latLng.lat;
        cityCounts[canonicalCity].lng = latLng.lng;
      }
      cityCounts[canonicalCity].count += r.count;
    }

    const cityList = Object.values(cityCounts);
    console.log("Processed cities list:", cityList);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

run();
