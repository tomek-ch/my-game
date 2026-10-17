import Phaser from 'phaser';
import Peer from 'peerjs';

// Online co-op transport: a WebRTC data channel between two browsers, set up through PeerJS's public
// broker (it only introduces the peers; game traffic goes directly between them). The host opens a
// room under a short code and the guest joins it with that code.
//
// Messages are plain objects with a type in `t`. A Link emits each one as an event named by its type,
// and 'close' when the other side goes away.

const ID_PREFIX = 'my-game-coop-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, which read as 1 and 0
const CODE_LENGTH = 4;

const randomCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class Link extends Phaser.Events.EventEmitter {
  constructor(peer, conn) {
    super();
    this.peer = peer;
    this.conn = conn;
    this.open = true;
    conn.on('data', (msg) => this.emit(msg.t, msg));
    const closed = () => {
      if (!this.open) return;
      this.open = false;
      this.emit('close');
    };
    conn.on('close', closed);
    conn.on('error', closed);
  }

  send(msg) {
    if (this.open) this.conn.send(msg);
  }

  close() {
    this.open = false;
    this.conn.close();
    this.peer.destroy();
  }
}

// Opens a room. Resolves with { code, cancel } once it's registered; onGuest(link) is called when a
// guest connects. Only the first guest is let in.
export function hostRoom(onGuest) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const code = randomCode();
      const peer = new Peer(ID_PREFIX + code);
      let taken = false;
      peer.on('open', () => resolve({ code, cancel: () => peer.destroy() }));
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          taken = true;
          peer.destroy();
          attempt(); // someone else has this code; roll another
        } else if (!taken) reject(err);
      });
      peer.on('connection', (conn) => {
        if (peer.guestJoined) {
          conn.on('open', () => conn.close());
          return;
        }
        peer.guestJoined = true;
        conn.on('open', () => onGuest(new Link(peer, conn)));
      });
    };
    attempt();
  });
}

// Joins the room with `code`. Resolves with a Link once connected.
export function joinRoom(code) {
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    const fail = (err) => {
      peer.destroy();
      reject(err.type === 'peer-unavailable' ? new Error(`No room ${code}`) : err);
    };
    peer.on('error', fail);
    peer.on('open', () => {
      const conn = peer.connect(ID_PREFIX + code.toUpperCase(), { reliable: true });
      conn.on('open', () => {
        peer.off('error', fail);
        resolve(new Link(peer, conn));
      });
    });
  });
}
