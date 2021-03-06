'use babel'
// vm.js should handle all javascript virtaul machine events
// Every solidity file can be compiled in two ways jsvm and ethereum endpoint
// After every command is invoked compilation endpoint should be chosen
// If JsVM is compilation endpoint VM will be used to compile and execute solidity program
import { CompositeDisposable } from 'atom'
import path from 'path'
import fs from 'fs'
import Solc from 'solc'
import Trie from 'merkle-patricia-tree'
import VmHelpers from './methods'
import { combineSource } from '../helpers/compiler-imports'

let View;
View = require('./view');

class VMEnv {
	constructor() {
		this.subscriptions = new CompositeDisposable();
		this.vmSubscriptions = new CompositeDisposable();
		this.saveSubscriptions = new CompositeDisposable();
		this.compileSubscriptions = new CompositeDisposable();
		this.observeConfig();
	}
	dispose() {
		if(this.subscriptions) {
			this.subscriptions.dispose()
		}
		this.subscriptions = null

		if(this.saveSubscriptions) {
			this.saveSubscriptions.dispose()
		}
		this.saveSubscriptions = null

		if(this.vmSubscriptions) {
			this.vmSubscriptions.dispose()
		}
		this.vmSubscriptions = null
	}
	destroy() {
		if(this.saveSubscriptions) {
			this.saveSubscriptions.dispose()
		}
		this.saveSubscriptions = null

		if(this.compileSubscriptions) {
			this.compileSubscriptions.dispose()
		}
		this.compileSubscriptions = null

		if(this.vmSubscriptions) {
			this.vmSubscriptions.dispose()
		}
		this.vmSubscriptions = null
	}
	observeConfig() {
		this.subscriptions.add(atom.config.observe('etheratom.executionEnv', (executionEnv) => {
			if(this.vmSubscriptions) {
				this.destroy();
			}
			this.vmSubscriptions = new CompositeDisposable();
			if(executionEnv == 'solcjs') {
				this.subscribeToVMCommands();
				this.subscribeToVMEvents();
			} else {
				return;
			}
		}));
		this.subscriptions.add(atom.config.onDidChange('etheratom.executionEnv', (envChange) => {
			if(envChange.newValue !== 'solcjs') {
				this.destroy();
			}
			if(envChange.newValue == 'solcjs') {
				if(this.vmSubscriptions) {
					this.vmSubscriptions.dispose();
				}
				this.vmSubscriptions = new CompositeDisposable();
				this.subscribeToVMCommands();
				this.subscribeToVMEvents();
			}
		}));
	}

	// Subscriptions
	subscribeToVMCommands() {
		if(!this.vmSubscriptions) {
			return
		}
		this.vmSubscriptions.add(atom.commands.add('atom-workspace', 'eth-interface:compile', () => {
			if(this.compileSubscriptions) {
				this.compileSubscriptions.dispose();
			}
			this.compileSubscriptions = new CompositeDisposable();
			this.subscribeToCompileEvents();
		}))
	}
	subscribeToVMEvents() {
		if(!this.vmSubscriptions) {
			return
		}
		let EthJSVM;
		EthJSVM = require('ethereumjs-vm');
		this.stateTrie = new Trie();
		this.vm = new EthJSVM({
			activatePrecompiles: true,
			enableHomestead: true,
			state: this.stateTrie
		});
		this.view = new View(this.vm);
		this.helpers = new VmHelpers(this.vm);
		this.view.createCompilerOptionsView();
		this.view.createCoinbaseView();
		this.view.createButtonsView();
		this.vmSubscriptions.add(atom.workspace.observeTextEditors((editor) => {
			if(!editor || !editor.getBuffer()) {
				return
			}

			this.vmSubscriptions.add(atom.config.observe('etheratom.compileOnSave', (compileOnSave) => {
				if(this.saveSubscriptions) {
					this.saveSubscriptions.dispose();
				}
				this.saveSubscriptions = new CompositeDisposable();
				if(compileOnSave) {
					this.subscribeToSaveEvents();
				}
			}));
		}));
	}

	// Event subscriptions
	subscribeToSaveEvents() {
		if(!this.vmSubscriptions) {
			return
		}
		this.saveSubscriptions.add(atom.workspace.observeTextEditors((editor) => {
			if(!editor || !editor.getBuffer()) {
				return
			}

			const bufferSubscriptions = new CompositeDisposable()
			bufferSubscriptions.add(editor.getBuffer().onDidSave((filePath) => {
				if(atom.config.get('etheratom.compileOnSave')) {
					this.compile(editor)
				}
			}))
			bufferSubscriptions.add(editor.getBuffer().onDidDestroy(() => {
				bufferSubscriptions.dispose()
			}))
			this.saveSubscriptions.add(bufferSubscriptions)
		}));
	}
	subscribeToCompileEvents() {
		if(!this.vmSubscriptions) {
			return
		}
		this.compileSubscriptions.add(atom.workspace.observeTextEditors((editor) => {
			if(!editor || !editor.getBuffer()) {
				return
			}
			this.compile(editor);
		}));
	}
	combineSource(dir, source, imports) {
		let fn, iline, ir, match, o, subSource;
		o = {
			encoding: 'UTF-8'
		};
		ir = /import\ [\'\"](.+)[\'\"]\;/g;
		match = null;
		while((match = ir.exec(source))) {
			iline = match[0];
			fn = match[1];
			if(imports[fn]) {
				source = source.replace(iline, '');
				continue;
			}
			imports[fn] = 1;
			subSource = fs.readFileSync(dir + "/" + fn, o);
			match.source = this.combineSource(mapSourceDir(dir,fn), subSource, imports);
			source = source.replace(iline, match.source);
		}
		return source;
	}
	async compile(editor) {
		if(editor) {
			let filename, filePath, dir;

			filePath = editor.getPath();
			filename = filePath.replace(/^.*[\\\/]/, '');
			if(filePath.split('.').pop() == 'sol') {
				dir = path.dirname(filePath);
				const source = await combineSource(dir, editor.getText());
				try {
					const compiled = await this.helpers.compileVM(source);
					this.view.reset();
					if(compiled.errors) {
						this.view.viewErrors(compiled.errors);
					}
					this.view.viewCompiled(compiled);
				} catch (error) {
					this.helpers.showPanelError(error);
				}
			} else {
				return;
			}
		} else {
			return;
		}
	}
}
export { VMEnv }
