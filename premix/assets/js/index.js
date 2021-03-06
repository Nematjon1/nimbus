var premix = function() {
  function chunkSubstr(str, size) {
    const numChunks = Math.ceil(str.length / size)
    const chunks = new Array(numChunks)

    for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
      chunks[i] = str.substr(o, size)
    }

    return chunks
  }

  function split32(text) {
    if(text.length > 32) {
      let chunks = chunkSubstr(text, 32);
      let result = "";
      for(var x of chunks) {
        result += '<div>'+x+'</div>';
      }
      return result;
    } else {
      return text;
    }
  }

  function renderCells(row, cls, cells) {
    for(var text of cells) {
      let cell = $(`<td ${cls}>${split32(text)}</td>`).appendTo(row);
      if(text.length > 32) cell.addClass('tm-monospace-cell');
    }
  }

  return {
    fields: ['op', 'pc', 'gas', 'gasCost', 'depth'],

    newTable: function(container) {
      let table = $('<table class="uk-table uk-table-divider"/>').appendTo(container);
      $('<thead><tr><th>Field</th><th>Nimbus</th><th>Geth</th></tr></thead>').appendTo(table);
      return $('<tbody></tbody>').appendTo(table);
    },

    renderRow: function(body, nimbus, geth, x) {
      let row = $('<tr/>').appendTo(body);
      let ncr = nimbus instanceof Object ? nimbus[x].toString().toLowerCase() : nimbus;
      let gcr = geth instanceof Object ? geth[x].toString().toLowerCase() : geth;
      let cls = ncr == gcr ? '' : 'class="uk-text-danger"';
      renderCells(row, cls, [x, ncr, gcr]);
    },

    newSection: function(container, title, colored) {
      let section = $('<div class="uk-section uk-section-xsmall tm-horizontal-overflow"></div>').appendTo(container);
      section.addClass(colored ? "uk-section-secondary uk-light" : "uk-section-muted");
      let contentDiv = $('<div class="uk-container uk-margin-small-left uk-margin-small-right"></div>').appendTo(section);
      $(`<h4>${title}</h4>`).appendTo(contentDiv);
      return contentDiv;
    }

  };
}();

function deepCopy(src) {
  return JSON.parse(JSON.stringify(src));
}

function windowResize() {
  let bodyHeight = $(window).height();
  $('#opCodeSideBar').css('height', parseInt(bodyHeight) - 80);
}

function renderTrace(title, nimbus, geth) {
  let container = $('#opCodeContainer').empty();
  let body = premix.newTable(container);
  for(var x of premix.fields) {
    premix.renderRow(body, nimbus, geth, x);
  }

  if(nimbus.error) {
    geth.error = '';
    premix.renderRow(body, nimbus, geth, 'error');
  }

  function renderExtra(name) {
    let nk = Object.keys(nimbus[name]);
    let gk = Object.keys(geth[name]);
    let keys = new Set(nk.concat(gk));

    if(keys.size > 0) {
      let section = premix.newSection(container, name);
      let body = premix.newTable(section);
      for(var key of keys) {
        premix.renderRow(body, nimbus[name], geth[name], key);
      }
      $('<hr class="uk-divider-icon">').appendTo(container);
    }
  }

  renderExtra("memory");
  renderExtra("stack");
  renderExtra("storage");
}

function opCodeRenderer(txId, nimbus, geth) {
  function analyzeList(nimbus, geth) {
    for(var i in nimbus) {
      if(nimbus[i].toString().toLowerCase() != geth[i].toString().toLowerCase()) return false;
    }
    return true;
  }

  function fillEmptyList(a, b) {
    if(a.length > b.length) {
      for(var i in a) {
        if(b[i] === undefined) {
          b[i] = '';
        }
      }
    }
  }

  function fillEmptyMap(a, b) {
    if(Object.keys(a).length > Object.keys(b).length) {
      for(var i in a) {
        if(b[i] === undefined) {
          b[i] = '';
        }
      }
    }
  }

  function fillEmptyField(nimbus, geth) {
    if(nimbus.memory === undefined) {
      nimbus.memory = [];
    }
    if(geth.memory === undefined) {
      geth.memory = [];
    }
    if(nimbus.stack === undefined) {
      nimbus.stack = [];
    }
    if(geth.stack === undefined) {
      geth.stack = [];
    }
    if(nimbus.storage === undefined) {
      nimbus.storage = {};
    }
    if(geth.storage === undefined) {
      geth.storage = {};
    }
    fillEmptyList(nimbus.memory, geth.memory);
    fillEmptyList(geth.memory, nimbus.memory);

    fillEmptyList(nimbus.stack, geth.stack);
    fillEmptyList(geth.stack, nimbus.stack);

    fillEmptyMap(nimbus.storage, geth.storage);
    fillEmptyMap(geth.storage, nimbus.storage);
  }

  function moveStack(ncs, gcs, i) {
    let idx = parseInt(i);
    ncs[idx-1].stack = deepCopy(ncs[idx].stack);
    gcs[idx-1].stack = deepCopy(gcs[idx].stack);
  }

  function analyze(nimbus, geth) {
    for(var x of premix.fields) {
      if(nimbus[x] === undefined) nimbus[x] = '';
      if(geth[x] === undefined) geth[x] = '';
      if(nimbus[x].toString().toLowerCase() != geth[x].toString().toLowerCase()) return false;
    }

    let result = analyzeList(nimbus.memory, geth.memory);
    result = result && analyzeList(nimbus.stack, geth.stack);
    result = result && analyzeList(nimbus.storage, geth.storage);
    return result;
  }

  txId = parseInt(txId);
  $('#opCodeTitle').text(`Tx #${(txId+1)}`);
  const numRows = Math.max(nimbus.txTraces[txId].structLogs.length, geth.txTraces[txId].structLogs.length);

  if(numRows == 0) {
    $('#opCodeContainer').empty();
    $('#paging').empty();
    $('#opCodeSideBar').empty();
    return;
  }

  const rowsPerPage = 500;
  var numPages = numRows / rowsPerPage;
  if(numRows % rowsPerPage != 0) numPages++;
    
  $("#paging").paging(numRows, {
    format: numPages < 10 ? "n".repeat(numPages) : '[< (qq -) nnncnnn (- pp) >]',
    perpage: rowsPerPage,
    lapping: 1,
    page: 1,
    onSelect: function (page) {
      const data = this.slice;
      const start = data[0];
      const stop = data[1];

      var ncs = deepCopy(nimbus.txTraces[txId].structLogs.slice(start, stop));
      var gcs = deepCopy(geth.txTraces[txId].structLogs.slice(start, stop));
      var sideBar = $('#opCodeSideBar').empty();

      function fillEmptyOp(a, b) {
        function emptyOp() {
          return {op: '', pc: '', gas: '', gasCost: '', depth: '',
            storage:{}, memory: [], stack: []};
        }

        if(a.length > b.length) {
          for(var i in a) {
            if(b[i] === undefined) {
              b[i] = emptyOp();
            }
          }
        }
      }

      fillEmptyOp(ncs, gcs);
      fillEmptyOp(gcs, ncs);

      for(var i in ncs) {
        fillEmptyField(ncs[i], gcs[i]);
        if(parseInt(i) > 0) {
          moveStack(ncs, gcs, i);
        }
      }

      for(var i in ncs) {
        let pc = ncs[i].pc == '' ? gcs[i].pc : ncs[i].pc;
        let op = ncs[i].op == '' ? gcs[i].op : ncs[i].op;
        if(!analyze(ncs[i], gcs[i])) {
          var nav = $(`<li><a class="tm-text-danger" rel="${i}" href="#">${pc + ' ' + op}</a></li>`).appendTo(sideBar);
        } else {
          var nav = $(`<li><a rel="${i}" href="#">${pc + ' ' + op}</a></li>`).appendTo(sideBar);
        }
        nav.children('a').click(function(ev) {
          let idx = this.rel;
          $('#opCodeSideBar li').removeClass('uk-active');
          $(this).parent().addClass('uk-active');
          renderTrace('tx', ncs[idx], gcs[idx]);
        });
      }

      if(ncs.length > 0) {
        renderTrace("tx", ncs[0], gcs[0]);
      } else {
        $('#opCodeContainer').empty();
      }

    },
    onFormat: function (type) {
      switch (type) {
      case 'block': // n and c
        if (this.value == this.page) {
          return '<li class="uk-active"><span>' + this.value + '</span></li>';
        } else {
          return '<li><a href="#">' + this.value + '</a></li>';
        }
      case 'next': // >
        return '<li><a href="#"><span uk-pagination-next></span></a></li>';
      case 'prev': // <
        return '<li><a href="#"><span uk-pagination-previous></span></a></li>';
      case 'first': // [
        return '<li><a href="#">first</a></li>';
      case 'last': // ]
        return '<li><a href="#">last</a></li>';
      case "leap":
        return "  ";
      case 'fill':
        return '<li class="uk-disabled"><span>...</span></li>';
      case 'left':
        if(this.value >= this.page) return '';
        return '<li><a href="#">' + this.value + '</a></li>';
      case 'right':
        if(this.value <= this.page) return '';
        return '<li><a href="#">' + this.value + '</a></li>';
      }
    }
  });

  windowResize();
}

function transactionsRenderer(txId, nimbus, geth) {
  txId = parseInt(txId);
  $('#transactionsTitle').text(`Tx #${(txId+1)}`);
  let container = $('#transactionsContainer').empty();

  function renderTx(nimbus, geth) {
    let body = premix.newTable(container);
    const fields = ["gas", "returnValue", "cumulativeGasUsed", "bloom"];
    for(var x of fields) {
      premix.renderRow(body, nimbus, geth, x);
    }
    $('<hr class="uk-divider-icon">').appendTo(container);

    if(nimbus.root || geth.root) {
      if(geth.root === undefined) geth.root = '';
      if(nimbus.root == undefined) nimbus.root = '';
      premix.renderRow(body, nimbus, geth, 'root');
    }

    if(nimbus.status || geth.status) {
      if(geth.status === undefined) geth.status = '';
      if(nimbus.status == undefined) nimbus.status = '';
      premix.renderRow(body, nimbus, geth, 'status');
    }

    function fillEmptyLogs(a, b) {
      function emptyLog() {
        return {address: '', topics: [], data: ''};
      }

      if(a.logs.length > b.logs.length) {
        for(var i in a.logs) {
          if(b.logs[i] === undefined) {
            b.logs[i] = emptyLog();
          }
        }
      }
    }

    fillEmptyLogs(geth, nimbus);
    fillEmptyLogs(nimbus, geth);

    for(var i in nimbus.logs) {
      $(`<h4>Receipt Log #${i}</h4>`).appendTo(container);
      let a = nimbus.logs[i];
      let b = geth.logs[i];
      //console.log(a.topics);
      a.topics = a.topics.join(',');
      b.topics = b.topics.join(',');
      let body = premix.newTable(container);
      premix.renderRow(body, a, b, 'address');
      premix.renderRow(body, a, b, 'data');
      premix.renderRow(body, a, b, 'topics');
      $('<hr class="uk-divider-icon">').appendTo(container);
    }
  }

  let tx  = geth.block.transactions[txId];
  let ntx = nimbus.txTraces[txId];
  let gtx = geth.txTraces[txId];

  if(ntx.returnValue.length == 0) {
    ntx.returnValue = "0x";
  }

  let ncr = $.extend({
    gas: ntx.gas,
    returnValue: ntx.returnValue
  },
    deepCopy(nimbus.receipts[txId])
  );

  let gcr = $.extend({
    gas: gtx.gas,
    returnValue: "0x" + gtx.returnValue
  },
    deepCopy(geth.receipts[txId])
  );

  $(`<h4>Transaction Kind: ${tx.txKind}</h4>`).appendTo(container);
  renderTx(ncr, gcr);
}

function accountsRenderer(nimbus, geth) {
  function emptyAccount() {
    return {
      address: '',
      nonce: '',
      balance: '',
      codeHash: '',
      code: '',
      storageRoot: '',
      storage: {}
    };
  }

  function precompiledContractsName(address) {
    switch(address) {
      case "0x0000000000000000000000000000000000000001": return "ecRecover";
      case "0x0000000000000000000000000000000000000002": return "Sha256";
      case "0x0000000000000000000000000000000000000003": return "RipeMd160";
      case "0x0000000000000000000000000000000000000004": return "Identity";
      case "0x0000000000000000000000000000000000000005": return "ModExp";
      case "0x0000000000000000000000000000000000000006": return "bn256ecAdd";
      case "0x0000000000000000000000000000000000000007": return "bn256ecMul";
      case "0x0000000000000000000000000000000000000008": return "bn256ecPairing";
      default: return "";
    }
  }

  let container = $('#accountsContainer').empty();
  $('#accountsTitle').text('Block #' + parseInt(geth.block.number, 16));

  let ncs = deepCopy(nimbus.stateDump.after);
  let gcs = deepCopy(geth.accounts);
  let accounts = [];

  for(var address in ncs) {
    let n = ncs[address];
    n.address = address;
    if(gcs[address]) {
      let geth = gcs[address];
      geth.address = address;
      accounts.push({name: n.name, nimbus: n, geth: geth});
      delete gcs[address];
    } else {
      accounts.push({name: n.name, nimbus: n, geth: emptyAccount()});
    }
  }

  for(var address in gcs) {
    let geth = gcs[address];
    geth.address = address;
    accounts.push({name: "unknown", nimbus: emptyAccount(), geth: geth});
  }

  for(var acc of accounts) {
    let pa = precompiledContractsName(acc.nimbus.address);
    let precompiledContract = pa == '' ? '' : ` or Precompiled Contract(${pa})`;
    $(`<h4>Account Name: ${acc.name}${precompiledContract}</h4>`).appendTo(container);
    let body = premix.newTable(container);
    const fields = ['address', 'nonce', 'balance', 'codeHash', 'code', 'storageRoot'];
    for(var x of fields) {
      premix.renderRow(body, acc.nimbus, acc.geth, x);
    }

    let storage = [];
    let nss = acc.nimbus.storage;
    let gss = acc.geth.storage;

    for(var idx in nss) {
      if(gss[idx]) {
        storage.push({idx: idx, nimbus: nss[idx], geth: gss[idx]});
        delete gss[idx];
      } else {
        if(nss[idx] != "0x0000000000000000000000000000000000000000000000000000000000000000") {
          storage.push({idx: idx, nimbus: nss[idx], geth: ''});
        }
      }
    }
    for(var idx in gss) {
      if(gss[idx] != "0x0000000000000000000000000000000000000000000000000000000000000000") {
        storage.push({idx: idx, nimbus: '', geth: gss[idx]});
      }
    }

    if(storage.length > 0) {
      $(`<h4>${acc.name} Storage</h4>`).appendTo(container);
      let body = premix.newTable(container);
      for(var s of storage) {
        premix.renderRow(body, s.nimbus, s.geth, s.idx);
      }
    }

    $('<hr class="uk-divider-icon">').appendTo(container);
  }
}

function headerRenderer(nimbus, geth) {
  let container = $('#headerContainer').empty();
  $('#headerTitle').text('Block #' + parseInt(geth.block.number, 16));

  let body = premix.newTable(container);
  const blockSummary = ['stateRoot', 'receiptsRoot', 'logsBloom'];
  for(var idx of blockSummary) {
    premix.renderRow(body, nimbus.block, geth.block, idx);
  }
}

function generateNavigation(txs, nimbus, geth) {
  function navAux(menuId, renderer) {
    let menu = $(menuId).click(function(ev) {
      renderer(0, nimbus, geth);
    });

    if(txs.length == 0) {
      menu.parent().addClass('uk-disabled');
    } else if(txs.length > 1) {
      $('<span uk-icon="icon: triangle-down"></span>').appendTo(menu);
      let div  = $('<div uk-dropdown="mode: hover;"/>').appendTo(menu.parent());
      let list = $('<ul class="uk-nav uk-dropdown-nav"/>').appendTo(div);

      for(var i in txs) {
        let id = parseInt(i) + 1;
        $(`<li class="uk-active"><a rel="${i}" href="#">TX #${id}</a></li>`).appendTo(list);
      }

      list.find('li a').click(function(ev) {
        renderer(this.rel, nimbus, geth);
      });
    }
  }

  navAux('#opCodeMenu', opCodeRenderer);
  navAux('#transactionsMenu', transactionsRenderer);

  $('#accountsMenu').click(function(ev) {
    accountsRenderer(nimbus, geth);
  });

  $('#headerMenu').click(function(ev) {
    headerRenderer(nimbus, geth);
  });
}

$(document).ready(function() {

  var nimbus = premixData.nimbus;
  var geth = premixData.geth;
  var transactions = geth.block.transactions;

  generateNavigation(transactions, nimbus, geth);
});