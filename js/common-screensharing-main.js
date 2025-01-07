'use strict';

const startButton = document.getElementById('startButton');
const hangupButton = document.getElementById('hangupButton');
hangupButton.disabled = true;

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

let localStream;
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

startButton.onclick = async () => {
    console.log('Start button clicked');
    localStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    localVideo.srcObject = localStream;

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
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
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
    localStream.getTracks().forEach(track => senderPC.addTrack(track, localStream));
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
        console.log('Received remote track');
        remoteVideo.srcObject = e.streams[0];
    };
}

async function makeCall() {
    createSenderPeerConnection();
    // createReceiverPeerConnection();

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