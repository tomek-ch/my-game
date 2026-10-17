import Phaser from 'phaser';
import Peer from 'peerjs';

// Online co-op transport: a WebRTC data channel between two browsers, set up through PeerJS's public
// broker (it only introduces the peers; game traffic goes directly between them). The host opens a
// room under a short code and the guest joins it with that code.
//
// Messages are plain objects with a type in `t`. A Link emits each one as an event named by its type,
// and 'close' when the other side goes away.
//
// Messages go as JSON text over PeerJS's raw mode, split into parts when long: a data channel message
// over about 16 KB can be refused or cut off (PeerJS's own JSON mode drops them), and a busy snapshot
// is bigger than that. A part is PART_MARK, then "id,index,count|", then its slice of the text; the
// channel is ordered and reliable, so the parts of a message arrive in order and complete.

const ID_PREFIX = 'my-game-coop-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, which read as 1 and 0
const CODE_LENGTH = 4;
const PART_CHARS = 5000; // well under 16 KB even if every character took three bytes
const PART_MARK = '~';   // a whole message is a JSON object, so it starts with '{' instead

const randomCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class Link extends Phaser.Events.EventEmitter {
  constructor(peer, conn) {
    super();
    this.peer = peer;
    this.conn = conn;
    this.open = true;
    this.nextMessageId = 1;
    this.parts = null; // the parts so far of a split message coming in
    conn.on('data', (text) => this.receive(text));
    conn.on('close', () => {
      if (!this.open) return;
      this.open = false;
      this.emit('close');
    });
    // Not a disconnect: PeerJS raises errors for single messages too, and the connection carries on.
    conn.on('error', (err) => console.error('Online link error:', err));
  }

  send(msg) {
    if (!this.open) return;
    const text = JSON.stringify(msg);
    if (text.length <= PART_CHARS) {
      this.conn.send(text);
      return;
    }
    const id = this.nextMessageId++;
    const count = Math.ceil(text.length / PART_CHARS);
    for (let i = 0; i < count; i++) {
      this.conn.send(`${PART_MARK}${id},${i},${count}|${text.slice(i * PART_CHARS, (i + 1) * PART_CHARS)}`);
    }
  }

  receive(text) {
    if (text[0] === PART_MARK) {
      const bar = text.indexOf('|');
      const [id, index, count] = text.slice(1, bar).split(',').map(Number);
      if (index === 0) this.parts = { id, slices: [] };
      if (this.parts?.id !== id) return; // joined partway through a message
      this.parts.slices.push(text.slice(bar + 1));
      if (index < count - 1) return;
      text = this.parts.slices.join('');
      this.parts = null;
    }
    const msg = JSON.parse(text);
    // A handler that throws is a bug to see in the console, not a reason to drop the next message.
    try {
      this.emit(msg.t, msg);
    } catch (err) {
      console.error(`Online: handling '${msg.t}' failed:`, err);
    }
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
      // Raw: Link does its own JSON and splitting. PeerJS's default binary packing recurses once per
      // array item and overflows the stack on a long one (a boss's telegraph has thousands of draw
      // commands), and its JSON mode drops anything over 16 KB.
      const conn = peer.connect(ID_PREFIX + code.toUpperCase(), { reliable: true, serialization: 'raw' });
      conn.on('open', () => {
        peer.off('error', fail);
        resolve(new Link(peer, conn));
      });
    });
  });
}
