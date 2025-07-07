import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { Peer } from "peerjs";
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Users,
} from "lucide-react";
//my code
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";

//

const VideoCallApp = () => {
  const { selectedUser } = useChatStore();
  const { authUser, socket } = useAuthStore();

  //   const [socket, setSocket] = useState(null);
  const [peer, setPeer] = useState(null);
  const [myPeerId, setMyPeerId] = useState("");
  const [mySocketId, setMySocketId] = useState("");
  const [connectedUsers, setConnectedUsers] = useState([]); //index.js
  const [currentCall, setCurrentCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callState, setCallState] = useState("idle"); // idle, calling, incoming, connected
  const [incomingCall, setIncomingCall] = useState(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [otherUserSocketId, setOtherUserSocketId] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const incomingCallRef = useRef(null);

  const cleanupMedia = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (peer) {
      peer.destroy();
    }
  };

  useEffect(() => {
    // Initialize Socket.IO
    // const newSocket = io("http://localhost:5000");

    socket.on("connect", () => {
      console.log("Connected to server:", socket.id);
      setMySocketId(socket.id);
    });

    socket.on("users-list", (users) => {
      setConnectedUsers(users);
      console.log("[VideoCallPage] users-list:", users);
    });

    socket.on("user-joined", (user) => {
      setConnectedUsers((prev) => {
        // Only add if not already present
        if (prev.some((u) => u.socketId === user.socketId)) {
          return prev;
        }
        const updated = [...prev, user];
        console.log("[VideoCallPage] user-joined, updated list:", updated);
        return updated;
      });
    });

    socket.on("user-left", (socketId) => {
      setConnectedUsers((prev) => {
        const updated = prev.filter((user) => user.socketId !== socketId);
        console.log("[VideoCallPage] user-left, updated list:", updated);
        return updated;
      });
    });

    socket.on("peer-registered", (user) => {
      setConnectedUsers((prev) =>
        prev.map((u) => (u.socketId === user.socketId ? user : u))
      );
    });

    socket.on("incoming-call", (data) => {
      setIncomingCall(data);
      setCallState("incoming");
      incomingCallRef.current = data;
    });

    // Buffer for call-accepted events that arrive before peer is ready
    let bufferedCallAccepted = null;

    // Initialize PeerJS
    const newPeer = new Peer();

    newPeer.on("open", (id) => {
      console.log("Peer ID:", id);
      setMyPeerId(id);
      socket.emit("register-peer", id);
      setPeer(newPeer);

      // Now set up socket events that require peer
      socket.on("call-accepted", async (data) => {
        console.log("Call accepted:", data);
        setCallState("connected");
        setOtherUserSocketId(data.answererSocketId);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          setLocalStream(stream);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
          // Call the answerer
          const call = newPeer.call(data.answererPeerId, stream);
          setCurrentCall(call);
          call.on("stream", (remoteStream) => {
            setRemoteStream(remoteStream);
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
            }
          });
        } catch (error) {
          console.error("Error accessing media devices:", error);
        }
      });
      // If there was a buffered call-accepted event, process it now
      if (bufferedCallAccepted) {
        socket.emit("call-accepted", bufferedCallAccepted);
        bufferedCallAccepted = null;
      }
    });

    newPeer.on("call", async (call) => {
      console.log("Receiving call");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        call.answer(stream);
        setCurrentCall(call);
        call.on("stream", (remoteStream) => {
          console.log("Received remote stream");
          setRemoteStream(remoteStream);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        });
      } catch (error) {
        console.error("Error accessing media devices:", error);
      }
    });

    socket.on("call-rejected", () => {
      setCallState("idle");
      setIncomingCall(null);
      alert("Call was rejected");
    });

    socket.on("call-failed", (data) => {
      setCallState("idle");
      alert(`Call failed: ${data.reason}`);
    });

    socket.on("call-ended", () => {
      endCall();
    });

    // setSocket(newSocket);

    return () => {
      cleanupMedia();
      // Optionally disconnect socket if you want
      // socket.disconnect();
    };
  }, []);

  const initiateCall = (targetUser) => {
    if (!peer || !socket) return;

    setCallState("calling");
    setOtherUserSocketId(targetUser.socketId);

    socket.emit("initiate-call", {
      targetSocketId: targetUser.socketId,
      callerPeerId: myPeerId,
    });
  };

  const acceptCall = () => {
    if (!socket || !incomingCall) return;

    setCallState("connected");
    setOtherUserSocketId(incomingCall.callerSocketId);

    socket.emit("accept-call", {
      callerSocketId: incomingCall.callerSocketId,
      answererPeerId: myPeerId,
    });

    setIncomingCall(null);
  };

  const rejectCall = () => {
    if (!socket || !incomingCall) return;

    socket.emit("reject-call", {
      callerSocketId: incomingCall.callerSocketId,
    });

    setCallState("idle");
    setIncomingCall(null);
  };

  const endCall = () => {
    if (socket && otherUserSocketId) {
      socket.emit("end-call", {
        otherSocketId: otherUserSocketId,
      });
    }

    if (currentCall) {
      currentCall.close();
    }

    cleanupMedia();

    setCurrentCall(null);
    setLocalStream(null);
    setRemoteStream(null);
    setCallState("idle");
    setIncomingCall(null);
    setOtherUserSocketId("");

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Video className="w-8 h-8 text-blue-400" />
            <h1 className="text-2xl font-bold">Video Call App</h1>
          </div>
          <div className="text-sm text-gray-400">
            <p>Socket ID: {mySocketId}</p>
            <p>Peer ID: {myPeerId}</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4">
        {/* Call State Display */}
        <div className="mb-4">
          <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-800">
            <div
              className={`w-2 h-2 rounded-full mr-2 ${
                callState === "connected"
                  ? "bg-green-400"
                  : callState === "calling"
                  ? "bg-yellow-400"
                  : callState === "incoming"
                  ? "bg-blue-400"
                  : "bg-gray-400"
              }`}
            ></div>
            Status: {callState.charAt(0).toUpperCase() + callState.slice(1)}
          </div>
        </div>

        {/* Video Call Interface */}
        {callState === "connected" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Remote Video */}
            <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 px-2 py-1 rounded text-sm">
                Remote User
              </div>
            </div>

            {/* Local Video */}
            <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 px-2 py-1 rounded text-sm">
                You
              </div>
            </div>
          </div>
        )}

        {/* Call Controls */}
        {callState === "connected" && (
          <div className="flex justify-center space-x-4 mb-6">
            <button
              onClick={toggleVideo}
              className={`p-3 rounded-full transition-colors ${
                isVideoEnabled
                  ? "bg-gray-700 hover:bg-gray-600"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {isVideoEnabled ? (
                <Video className="w-6 h-6" />
              ) : (
                <VideoOff className="w-6 h-6" />
              )}
            </button>

            <button
              onClick={toggleAudio}
              className={`p-3 rounded-full transition-colors ${
                isAudioEnabled
                  ? "bg-gray-700 hover:bg-gray-600"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {isAudioEnabled ? (
                <Mic className="w-6 h-6" />
              ) : (
                <MicOff className="w-6 h-6" />
              )}
            </button>

            <button
              onClick={endCall}
              className="p-3 rounded-full bg-red-600 hover:bg-red-700 transition-colors"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </div>
        )}

        {/* Incoming Call Modal */}
        {callState === "incoming" && incomingCall && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
              <div className="text-center">
                <PhoneCall className="w-16 h-16 text-blue-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold mb-2">Incoming Call</h3>
                <p className="text-gray-400 mb-6">
                  Call from: {incomingCall.callerSocketId}
                </p>
                <div className="flex space-x-4">
                  <button
                    onClick={acceptCall}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={rejectCall}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Connected Users List */}
        {callState === "idle" && (
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="flex items-center mb-4">
              <Users className="w-6 h-6 text-blue-400 mr-2" />
              <h2 className="text-xl font-bold">Connected Users</h2>
            </div>

            {connectedUsers.length === 0 ? (
              <p className="text-gray-400">No other users connected</p>
            ) : (
              <div className="space-y-2">
                {Array.from(
                  new Map(
                    connectedUsers
                      .filter((user) => user.socketId !== mySocketId)
                      .map((user) => [user.socketId, user])
                  ).values()
                ).map((user) => (
                  <div key={user.socketId}>
                    <div
                      key={user.socketId}
                      className="flex items-center justify-between p-3 bg-gray-700 rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{user.socketId}</p>
                        <p className="text-sm text-gray-400">
                          {user.inCall ? "In Call" : "Available"}
                        </p>
                      </div>
                      <button
                        onClick={() => initiateCall(user)}
                        disabled={user.inCall || !user.peerId}
                        className={`px-4 py-2 rounded-lg transition-colors ${
                          user.inCall || !user.peerId
                            ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                            : "bg-blue-600 hover:bg-blue-700 text-white"
                        }`}
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Calling State */}
        {callState === "calling" && (
          <div className="text-center py-8">
            <PhoneCall className="w-16 h-16 text-blue-400 mx-auto mb-4 animate-pulse" />
            <h3 className="text-xl font-bold mb-2">Calling...</h3>
            <p className="text-gray-400 mb-4">Waiting for response</p>
            <button
              onClick={endCall}
              className="bg-red-600 hover:bg-red-700 text-white py-2 px-6 rounded-lg transition-colors"
            >
              Cancel Call
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCallApp;
