var socket = io()

$(function() {
  // use an object to store the round num so timerChange() can check for
  // the correct round
  var round = {}
  var stats = {}
  
  $('.play-btn').click(function() {
    socket.emit('play')
    
    $('.play-btn').css('display', 'none')
    $('.info-box').append('<p>Waiting for a partner...</p>')
  })
  
  $('.play-again-btn').click(function() {
    socket.emit('play')
    
    $('.play-again-text').css('display', 'none')
    $('.waiting-text').css('display', 'inline')
  })
  
  $('.arrow-right').click(function() {
    if (stats['displaying'] + 1 in stats) {
      loadStats(stats, stats['displaying'] + 1)
    }
  })
  
  $('.arrow-left').click(function() {
    if (stats['displaying'] - 1 in stats) {
      loadStats(stats, stats['displaying'] - 1)
    }
  })
  
  $('.label-input').keydown(function(ev) {
    // enter key press
    if (ev.keyCode === 13) {
      var label = $('.game .label-input').val().toLowerCase().trim()
      // add label
      $('.game .label-list').append(newLabel(label, false))
      $('.label-input').val('')
      // scroll to bottom of inputted labels
      $('.labels').scrollTop($('.labels').prop('scrollHeight'))
      socket.emit('label', label)
    }
  })
  
  $(document).on('load', '.game .image', function() {
    console.log('loaded')
    socket.emit('loadedImage')
  })
  
  socket.on('ready', function(data) {
    round['num'] = data['round']
    var image = data['image']
    var endTime = data['end']
    // hide the overlay, show the game
    if (round['num'] === 1) {
      $('.overlay').css('display', 'none')
      $('.game').css('display', 'table')
    }
    
    $('.image').empty()
    $('.image').append('<img src="' + image + '" onload="imageLoaded()">')
    
    // hide the info for now
    
    $('.game .info').css('visibility','hidden')
  })
  
  socket.on('endTime', function(data) {
    $('.game .info').css('visibility','visible')
    restartRound()
    timerChange(data, round['num'], round)
  })
  
  socket.on('match', function(data) {
    var label = data.toLowerCase()
    console.log('match', label)
    $('.label-container.bad').each(function() {
      if ($(this).html().toLowerCase() === label) {
        $(this).removeClass('bad')
        $(this).addClass('good')
        // break the .each loop
        return false;
      }
    })
  })
  
  socket.on('end', function(data) {
    console.log('end game')
    stats = JSON.parse(data)
    endGame(stats)
  })
  
  socket.on('partner-disc', function(data) {
    console.log('disconnected')
    stats = JSON.parse(data)
    endGame(stats)
  })
})

function timerChange(endTime, roundNum, round) {
  if (roundNum !== round['num']) {
    return
  }
  var timeLeft = Math.max(Math.ceil((endTime - Date.now()) / 1000), 0)
  $('.time-text').html(timeLeft)
  if (timeLeft > 0) {
    setTimeout(function() {
      timerChange(endTime, roundNum, round)
    }, 1000)
  }
}

function restartAnimation(el) {
  // trick found here: https://css-tricks.com/restart-css-animation/
	el.classList.remove('begin')
	el.offsetWidth = el.offsetWidth
	el.classList.add('begin')
}

function restartRound() {
  // clear the labels
  $('.label-list').empty()
  // restart animations
  var a = ['.spinner', '.fill', '.cover']
  a.forEach(function(query) {
    restartAnimation(document.querySelector(query))
  })
}

function newLabel(label, good) {
  return '<li><div class="label-container ' + (good ? 'good': 'bad') + '">' + 
    label +
  '</div></li>'
}

function loadStats(stats, round) {
  round = round || 1
  stats['displaying'] = round
  if (!(round in stats)) {
    return
  }
  if (!(round + 1 in stats)) {
    $('.arrow-right').css('display', 'none')
  } else {
    $('.arrow-right').css('display', 'inline')
  }
  if (!(round - 1 in stats)) {
    $('.arrow-left').css('display', 'none')
  } else {
    $('.arrow-left').css('display', 'inline')
  }
  // clear all the stuff
  $('.both td .label-list, .yours td .label-list, .theirs td .label-list, .points td').empty()
  $('.stats .image-container img').attr('src', stats[round]['image'])
  $('.stats-table .label-list').empty()
  stats[round]['both'].forEach(function (label) {
    $('.both td .label-list').append(newLabel(label, true))
  })
  stats[round]['yours'].forEach(function (label) {
    $('.yours td .label-list').append(newLabel(label, false))
  })
  stats[round]['theirs'].forEach(function (label) {
    $('.theirs td .label-list').append(newLabel(label, false))
  })
  $('.points td').append(stats[round]['points'])
}

function imageLoaded() {
  console.log('loaded')
  socket.emit('loadedImage')
}

function endGame(stats) {
  stats['displaying'] = 0
  // empty stats
  $('.label-list').empty()
  $('.points td').empty()
  // remove the info-box from the start of the game
  $('.info-box').css('display', 'none')
  // show the stats box
  $('.stats-container').css('display', 'inline')
  // hide the game
  $('.game').css('display', 'none')
  // show the overlay
  $('.overlay').css('display', 'inline')
  // make sure play again text is set again, rather than the waiting... text
  $('.play-again-text').css('display', 'inline')
  $('.waiting-text').css('display', 'none')
  loadStats(stats)
}
  