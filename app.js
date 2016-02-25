'use strict'
let express = require('express')
let app = express()
let server = require('http').createServer(app)
let io = require('socket.io')(server)
let https = require('https')

//let imgurAPIKey = process.env.IMGUR_API_ID
let consumerKey = process.env.CONSUMER_KEY
//if (!imgurAPIKey) {
//  throw 'set imgur API id with export IMGUR_API_ID=your_id'
//}
if (!consumerKey) {
  throw 'set 500px consumer key with export CONSUMER_KEY=your_key'
}

let waiting = []
let rooms = {}
let socketsRooms = {}
// images is an array of urls to images to be used in the game
let images = []

server.listen(3000, () => {
  // initialize images with some urls
  pullImages((urls) => {
    images = images.concat(urls)
  })
  console.log('running on port 3000')
})

app.use(express.static('public'))

io.on('connection', (socket) => {
  console.log('joined', socket.id)

  socket.on('play', () => {
    if (waiting.length === 0) {
      waiting.push(socket)
    } else if (waiting.indexOf(socket) === -1) {
      // guard checks if client is already in waiting list
      let room = randString()
      while (room in rooms) {
        room = randString()
      }
      socket.join(room)
      waiting[0].join(room)
      rooms[room] = {}
      rooms[room]['sockets'] = [socket, waiting[0]]
      rooms[room]['labels'] = {}
      rooms[room]['labels'][waiting[0].id] = new Set()
      rooms[room]['labels'][socket.id] = new Set()
      rooms[room]['rounds'] = []
      rooms[room]['roundNum'] = 1
      rooms[room]['sockets'].forEach((soc) => {
        socketsRooms[soc.id] = room
      })
      waiting = waiting.slice(1)
      timeRounds(room)
    }
  })

  socket.on('label', (data) => {
    if (Object.keys(socket.rooms).length < 2) {
      console.log('error, socket is not in a room', socket.id)
      return
    }
    let room = Object.keys(socket.rooms)[1]
    if (!(room in rooms)) {
      console.log('error, room does not exist', socket.id)
      return
    }
    if (!rooms[room]['active']) {
      // if the room is inactive, meaning in between rounds, ignore
      // incoming labels
      console.log('ignored label', data)
      return
    }
    let label = data.trim().toLowerCase()
    let otherId = findOtherId(room, socket.id)
    rooms[room]['labels'][socket.id].add(label)
    if (rooms[room]['labels'][otherId].has(label)) {
      io.to(room).emit('match', label)
    }
  })

  socket.on('disconnect', () => {
    console.log('disconnected', socket.id)
    let room = socketsRooms[socket.id]
    if (room) {
      // if it's in a room, tell the other player they left, and make them
      // leave the room. also reset the labels, so the round info is generated
      // for the interrupted round
      resetLabels(room)
      rooms[room]['sockets'].forEach((soc) => {
        if (soc !== socket) {
          io.to(room).emit('partner-disc', JSON.stringify(generateInfo(room, soc.id)))
          soc.leave(room)
        }
        // delete both their data from the socketsRooms object
        delete socketsRooms[soc.id]
      })
      delete rooms[room]
    }
  })
})

function findOtherId(room, socketId) {
  return rooms[room]['sockets'].find((socket) => {
    return socket.id !== socketId
  }).id
}

function timeRounds(room) {
  // if the room was deleted because of a disconnection, stop timing rounds
  if (!(room in rooms)) {
    return
  }
  // room is inactive until the images have loaded and the round has begun
  rooms[room]['active'] = false
  let roundLength = 5000
  let numRounds = 2
  if (rooms[room]['roundNum'] <= numRounds) {
    nextImage((img) => {
      io.to(room).emit('ready', {
        'round': rooms[room]['roundNum'],
        'image': img,
        'end': Date.now() + roundLength
      })
      // wait for both sockets to load the image before continuing
      // probably better accomplished with async, or something else
      let oneSocketLoaded = false
      rooms[room]['sockets'][0].once('loadedImage', () => { 
        if (oneSocketLoaded) {
          runTimeRoundsAgain(room, roundLength, img)
        } else {
          oneSocketLoaded = true
        }
      })
      rooms[room]['sockets'][1].once('loadedImage', () => { 
        if (oneSocketLoaded) {
          runTimeRoundsAgain(room, roundLength, img)
        } else {
          oneSocketLoaded = true
        }
      })
    })
  } else {
    // check if the room still exists
    if (!(room in rooms)) {
      return
    }
    rooms[room]['sockets'].forEach((socket) => {
      socket.emit('end', JSON.stringify(generateInfo(room, socket.id)))
      socket.leave(room)
      delete socketsRooms[socket.id]
    })
    delete rooms[room]
  }
}

function runTimeRoundsAgain(room, roundLength, img) {
  rooms[room]['active'] = true
  io.to(room).emit('endTime', Date.now() + roundLength)
  setTimeout(() => {
    // if the room was deleted because of a disconnection, stop timing rounds
    if (!(room in rooms)) {
      return
    }
    resetLabels(room, img)
    rooms[room]['roundNum']++
    timeRounds(room)
  }, roundLength)
}

function resetLabels(room, img) {
  // store the info from the last round
  let labelsCopy = {}
  Object.keys(rooms[room]['labels']).forEach((id) => {
    labelsCopy[id] = [...rooms[room]['labels'][id]]
  })
  rooms[room]['rounds'].push({
    'round': rooms[room]['roundNum'],
    'labels': labelsCopy,
    'image': img
  })
  // clear the labels
  Object.keys(rooms[room]['labels']).forEach((id) => {
    rooms[room]['labels'][id].clear()
  })
}
  

function nextImage(cb) {
  // callback accepts an image URL
  // if there's less than 10 images left
  if (images.length < 10) {
    pullImages((urls) => {
      // concat rather than assign just in case this function was
      // called by another socket, and some images had already been added
      images = images.concat(urls)
      cb(images.pop())
    })
  } else {
    cb(images.pop())
  }
}

function pullImages(cb) {
/*  let options = {
    'hostname': 'api.500px.com',
    'path': `/v1/photos?feature=fresh_today&image_size=image_size=3,440,600&consumer_key=${consumerKey}`
  }
  let req = https.request(options, (res) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', (d) => {
      data += d
    })
    res.on('end', () => {
      let urls = JSON.parse(data)['photos'].filter((photoData) => {
        return !photoData['nsfw']
      }).map((photoData) => {
        return photoData['image_url']
      })
      if (urls.length === 0) {
        pullImages(cb)
      } else {
        cb(urls)
      }
    })
  })
  req.end()
  req.on('error', console.log)*/
  cb(['https://drscdn.500px.org/photo/141790243/w%3D440_h%3D440/52553730ebca05f3d64ae6f33f22b5dc?v=3'])
}

function generateInfo(room, socketId) {
  let info = {}
  let otherId = findOtherId(room, socketId)
  let rounds = rooms[room]['rounds']
  rounds.forEach((roundObj) => {
    let roundNum = roundObj['round']
    info[roundNum] = {
      'both': intersect(roundObj['labels'][socketId], roundObj['labels'][otherId]),
      'yours': notIntersect(roundObj['labels'][socketId], roundObj['labels'][otherId]),
      'theirs': notIntersect(roundObj['labels'][otherId], roundObj['labels'][socketId]),
      'image': roundObj['image']
    }
    info[roundNum]['points'] = getPoints(info[roundNum]['both'])
  })
  return info
}


function intersect(s1, s2) {
  return s1.filter((el) => {
    return s2.indexOf(el) !== -1
  })
}

function notIntersect(s1, s2) {
  return s1.filter((el) => {
    return s2.indexOf(el) === -1
  })
}

function randString(len) {
  // yeah, you could just hardcode possible characters, but that wouldn't be cool
  // default length of 5
  len = len || 5
  let str = ''
  for (let i = 0; i < len; i++) {
    let c = Math.random() * 62
    if (c < 10) {
      // 48 - 57 ten are numerals
      c += 48
    } else if (c < 36) {
      // 65 - 90 are capitals
      c += 55
    } else if (c < 62) {
      // 97 - 122 are lowercase
      c += 61
    }
    str += String.fromCharCode(c)
  }
  return str
}

function getPoints(labels) {
  // as of now the algorithm simply gives 1 point for each word in a labels
  return labels.reduce((sum, label) => {
    return sum + label.split(' ').filter((word) => {
      return word !== ''
    }).length
  }, 0)
}

/* Imgur gives cruddy images, this function isn't being used right now
function pullImagesImgur(cb) {
  // callback accepts an array of URLs to images
  let options = {
    'hostname': 'api.imgur.com',
    'path': '/3/gallery/random/random',
    'headers': {
      'authorization': `Client-ID ${imgurAPIKey}`
    }
  }
  let req = https.request(options, (res) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', (d) => {
      data += d
    })
    res.on('end', () => {
      let urls = JSON.parse(data)['data'].filter((el) => {
        let animated = el['type'] === 'image/gif' && el['animated'] === true
        return !el['nsfw'] && !el['is_album'] && !animated
      }).map((el) => {
        return el['link']
      })
      if (urls.length === 0) {
        // if no images were found matching the criteria, make another request
        pullImagesImgur(cb)
      } else {
        cb(urls)
      }
    })
  })
  req.end()
  req.on('error', console.log)
}
*/