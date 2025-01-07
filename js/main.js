'use strict';

const startButton = document.getElementById('startButton');
const hangupButton = document.getElementById('hangupButton');
hangupButton.disabled = true;

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localAudioSelect = document.getElementById('localAudioSelect');
const remoteAudioSelect = document.getElementById('remoteAudioSelect');

let localStream, videoStream, combinedStream, remoteStream;
let senderPC;
let receiverPC;

const senderChannel = new BroadcastChannel('webrtc');
const receiverChannel = new BroadcastChannel('webrtc');

senderChannel.onmessage = async (e) => {
  console.log('Sender received message:', e.data);
  switch (e.data.type) {
    case 'answer':
      await handleAnswer(e.data);
      break;
    case 'candidate':
      await handleCandidate(e.data, senderPC);
      break;
    default:
      console.log('Unhandled message type:', e.data.type);
      break;
  }
};

receiverChannel.onmessage = async (e) => {
  console.log('Receiver received message:', e.data);
  switch (e.data.type) {
    case 'offer':
      await handleOffer(e.data);
      break;
    case 'candidate':
      await handleCandidate(e.data, receiverPC);
      break;
    case 'ready':
      // A second tab joined. This tab will initiate a call unless in a call already.
      if (senderPC) {
        console.log('Already in call, ignoring');
        return;
      }
      console.log('Ready to make call');
      await makeCall();
      break;
    case 'bye':
      if (senderPC) {
        await hangup();
      }
      break;
    default:
      console.log('Unhandled message type:', e.data.type);
      break;
  }
};

async function getAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioDevices = devices.filter(device => device.kind === 'audioinput');
  const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput');

  audioDevices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.text = device.label || `Microphone ${localAudioSelect.length + 1}`;
    localAudioSelect.appendChild(option);
  });

  audioOutputDevices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.text = device.label || `Speaker ${remoteAudioSelect.length + 1}`;
    remoteAudioSelect.appendChild(option);
  });
}

getAudioDevices();

startButton.onclick = async () => {
  console.log('Start button clicked');
  const selectedAudioDeviceId = localAudioSelect.value;

  const micAudioStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: selectedAudioDeviceId ? { exact: selectedAudioDeviceId } : undefined }
  });
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  const micSource = ac.createMediaStreamSource(micAudioStream);
  const systemAudioSource = ac.createMediaStreamSource(stream);
  micSource.connect(dest);
  systemAudioSource.connect(dest);

  videoStream = new MediaStream([...stream.getVideoTracks()]);
  combinedStream = new MediaStream([...dest.stream.getAudioTracks()]);

  
  startButton.disabled = true;
  hangupButton.disabled = false;

  senderChannel.postMessage({ type: 'ready' });
};

hangupButton.onclick = async () => {
  await hangup();
  receiverChannel.postMessage({ type: 'bye' });
};

async function hangup() {
  if (senderPC) {
    senderPC.close();
    senderPC = null;
  }
  if (receiverPC) {
    receiverPC.close();
    receiverPC = null;
  }
  startButton.disabled = false;
  hangupButton.disabled = true;
}

function createSenderPeerConnection() {
  senderPC = new RTCPeerConnection();
  senderPC.onicecandidate = e => {
    const message = {
      type: 'candidate',
      candidate: null,
    };
    if (e.candidate) {
      message.candidate = e.candidate.candidate;
      message.sdpMid = e.candidate.sdpMid;
      message.sdpMLineIndex = e.candidate.sdpMLineIndex;
    }
    console.log('Sending ICE candidate from sender:', message);
    senderChannel.postMessage(message);
  };
  combinedStream.getTracks().forEach(track => senderPC.addTrack(track, combinedStream));
  videoStream.getTracks().forEach(track => senderPC.addTrack(track, videoStream));
}

async function playAudioOnDevice(stream, deviceId) {
  const audioElement = document.createElement('audio');
  audioElement.srcObject = stream;
  audioElement.autoplay = true;
  document.body.appendChild(audioElement);

  try {
    await navigator.mediaDevices.getUserMedia({
      audio: true
    });
    await audioElement.setSinkId(deviceId);
    console.log(`Audio is being played on device: ${deviceId}`);
  } catch (error) {
    console.error('Error setting audio output device:', error);
  }
}

function createReceiverPeerConnection() {
  receiverPC = new RTCPeerConnection();
  receiverPC.onicecandidate = e => {
    const message = {
      type: 'candidate',
      candidate: null,
    };
    if (e.candidate) {
      message.candidate = e.candidate.candidate;
      message.sdpMid = e.candidate.sdpMid;
      message.sdpMLineIndex = e.candidate.sdpMLineIndex;
    }
    console.log('Sending ICE candidate from receiver:', message);
    receiverChannel.postMessage(message);
  };

  receiverPC.ontrack = e => {
    if (e.track.kind === 'audio') {
      console.log('Received remote audio track');
      if (e.streams && e.streams[0]) {
        remoteStream = e.streams[0];
      } else {
        if (!remoteStream) {
          remoteStream = new MediaStream();
        }
        remoteStream.addTrack(e.track);
      }
    }
    if (e.track.kind === 'video') {
      console.log('Received remote video track');
      remoteVideo.srcObject = e.streams[0];
    }
  };
}

async function makeCall() {
  createSenderPeerConnection();

  const offer = await senderPC.createOffer();
  await senderPC.setLocalDescription(offer);
  console.log('Sending offer:', offer);
  senderChannel.postMessage({ type: 'offer', sdp: offer.sdp });
}

async function handleOffer(offer) {
  if (receiverPC) {
    console.error('Existing peer connection');
    return;
  }
  createReceiverPeerConnection();
  await receiverPC.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await receiverPC.createAnswer();
  await receiverPC.setLocalDescription(answer);
  console.log('Sending answer:', answer);
  receiverChannel.postMessage({ type: 'answer', sdp: answer.sdp });
}

async function handleAnswer(answer) {
  if (!senderPC) {
    console.error('No peer connection');
    return;
  }
  await senderPC.setRemoteDescription(new RTCSessionDescription(answer));
  const selectedAudioOutputDeviceId = remoteAudioSelect.value;
  playAudioOnDevice(remoteStream, selectedAudioOutputDeviceId);
}

async function handleCandidate(candidate, pc) {
  if (!pc) {
    console.error('No peer connection');
    return;
  }
  if (!candidate.candidate) {
    await pc.addIceCandidate(null);
  } else {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}