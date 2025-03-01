import type { Client } from "../../server/src/game/client.ts";
import { Game } from "../../server/src/game/game.ts";
import { type ProcessMsg, ProcessMsgType } from "../../server/src/game/ipcTypes.ts";
import { ClientSocket } from "../../server/src/game/socket.ts";

let game: Game | undefined;

function sendMsg(msg: ProcessMsg) {
    postMessage(msg);
}

const socketMsgs: Array<{
    socketId: string;
    ip: string;
    data: ArrayBuffer | Uint8Array;
}> = [];

const socketIdToSocket = new Map<string, ProcessSocket<Client | undefined>>();
class ProcessSocket<T> extends ClientSocket<T> {
    private _id: string;
    private _ip: string;
    _closed = false;
    constructor(id: string, ip: string) {
        super();
        this._id = id;
        this._ip = ip;
    }

    ip(): string {
        return this._ip;
    }

    closed(): boolean {
        return this._closed;
    }

    send(data: Uint8Array<ArrayBuffer>): void {
        if (this.closed()) return;

        socketMsgs.push({
            socketId: this._id,
            data,
            ip: "",
        });
    }
    close(): void {
        this._closed = true;
        sendMsg({
            type: ProcessMsgType.SocketClose,
            socketId: this._id,
            reason: undefined,
        });
    }

    closeWithReason(reason: string): void {
        sendMsg({
            type: ProcessMsgType.SocketClose,
            socketId: this._id,
            reason: reason,
        });
    }
}

addEventListener("message", async (message) => {
    const msg = message.data as ProcessMsg;

    if (msg.type === ProcessMsgType.Create && !game) {
        game = new Game(
            msg.id,
            msg.config,
        );

        sendMsg({
            type: ProcessMsgType.Created,
        });
    }

    if (!game) return;

    switch (msg.type) {
        case ProcessMsgType.AddJoinToken:
            game.addJoinTokens(msg.tokens, false);
            break;
        case ProcessMsgType.SocketOpen: {
            const socket = new ProcessSocket<Client | undefined>(msg.socketId, msg.ip);
            socketIdToSocket.set(msg.socketId, socket);
            break;
        }
        case ProcessMsgType.ClientSocketMsg: {
            let socket = socketIdToSocket.get(msg.socketId)!;
            game.clientBarn.handleMsg(msg.data as ArrayBuffer, socket);
            break;
        }
        case ProcessMsgType.SocketClose: {
            const socket = socketIdToSocket.get(msg.socketId)!;
            socket._closed = true;
            game.clientBarn.handleSocketClose(socket);
            socketIdToSocket.delete(msg.socketId);
            break;
        }
    }
});

setInterval(() => {
    if (game) {
        game?.updateData();
    } else {
        sendMsg({
            type: ProcessMsgType.KeepAlive,
        });
    }
}, 5000);

setInterval(() => {
    game?.update();
}, 1000 / 100);

setInterval(() => {
    game?.netSync();
    sendMsg({
        type: ProcessMsgType.ServerSocketMsg,
        msgs: socketMsgs,
    });
    socketMsgs.length = 0;
}, 1000 / 50);
