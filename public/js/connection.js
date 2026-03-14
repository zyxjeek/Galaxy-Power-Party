(function() {
  const { state, dom, send, setMessage } = GPP;

  dom.createBtn.onclick = () => {
    send('create_room', { name: GPP.getMyName() });
  };

  dom.joinBtn.onclick = () => {
    send('join_room', { name: GPP.getMyName(), code: dom.roomCodeInput.value.trim() });
  };

  dom.leaveBtn.onclick = () => {
    GPP.clearSelection();
    send('leave_room');
  };

  dom.docBtn.onclick = () => GPP.showDocModal();

  function connect() {
    GPP.ws = new WebSocket(`${GPP.wsProtocol}//${location.host}`);

    GPP.ws.onopen = () => {
      GPP.reconnectDelay = 1000;
      setMessage('已连接服务器。');
    };

    GPP.ws.onclose = () => {
      setMessage(`连接断开，${Math.round(GPP.reconnectDelay / 1000)}秒后自动重连...`);
      setTimeout(() => {
        GPP.reconnectDelay = Math.min(GPP.reconnectDelay * 2, GPP.MAX_RECONNECT_DELAY);
        connect();
      }, GPP.reconnectDelay);
    };

    GPP.ws.onerror = () => {};

    GPP.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'welcome') {
        state.me = msg.playerId;
        (msg.characters || []).forEach((c) => {
          state.characters[c.id] = c;
        });
        state.auroraDice = msg.auroraDice || [];
        dom.myIdEl.textContent = `玩家ID：${msg.playerId}`;
        setMessage('连接成功。你可以创建或加入房间。');
        return;
      }

      if (msg.type === 'room_state') {
        state.pendingAction = null;
        const prevRoomCode = state.room && state.room.code;
        const prevHadGame = !!(state.room && state.room.game);

        state.room = msg.room;
        if (!state.room.game) {
          GPP.clearSelection();
          state.lastProcessedEffectId = 0;
        } else if (state.room.game.phase === 'attack_reroll_or_select' && state.room.game.attackerId === state.me) {
          GPP.setSelection(state.room.game.attackPreviewSelection || []);
        } else if (state.room.game.phase === 'defense_select' && state.room.game.defenderId === state.me) {
          GPP.setSelection(state.room.game.defensePreviewSelection || []);
        } else {
          GPP.clearSelection();
        }

        GPP.render();
        GPP.processEffectEvents(state.room.game || {}, prevRoomCode === state.room.code && prevHadGame);
        return;
      }

      if (msg.type === 'left_room') {
        state.pendingAction = null;
        state.room = null;
        GPP.clearSelection();
        state.lastProcessedEffectId = 0;
        GPP.render();
        const reason = msg.reason || '你已退出房间。';
        setMessage(reason);
        GPP.showErrorToast(reason);
        return;
      }

      if (msg.type === 'error') {
        state.pendingAction = null;
        setMessage(`错误：${msg.message}`);
        GPP.showErrorToast(msg.message);
        GPP.render();
      }
    };
  }

  connect();
  GPP.render();
})();
