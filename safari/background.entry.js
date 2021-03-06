/* global safari: false */

import { addCommonBackgroundListeners } from '../lib/environment/common/listeners';
import { createMessageHandler } from '../lib/environment/common/messaging';
import { extendDeep } from '../lib/utils/object';

const {
	_handleMessage,
	sendMessage,
	addListener,
} = createMessageHandler((type, obj, tab) => tab.page.dispatchMessage(type, obj));

safari.application.addEventListener('message', ({ name: type, message: obj, target: tab }) => {
	_handleMessage(type, obj, tab);
});

// Listeners

addCommonBackgroundListeners(addListener);

addListener('ajax', async ({ method, url, headers, data, credentials }) => {
	const request = new XMLHttpRequest();

	const load = Promise.race([
		new Promise(resolve => (request.onload = resolve)),
		new Promise(resolve => (request.onerror = resolve))
			.then(() => { throw new Error(`XHR error - url: ${url}`); }),
	]);

	request.open(method, url, true);

	for (const name in headers) {
		request.setRequestHeader(name, headers[name]);
	}

	if (credentials) {
		request.withCredentials = true;
	}

	request.send(data);

	await load;

	// Only store `status`, `responseText` and `responseURL` fields
	return {
		status: request.status,
		responseText: request.responseText,
		responseURL: request.responseURL,
	};
});

addListener('storage', ([operation, key, value]) => {
	switch (operation) {
		case 'get':
			try {
				return JSON.parse(localStorage.getItem(key));
			} catch (e) {
				console.warn('Failed to parse:', key, 'falling back to raw string.');
			}
			return localStorage.getItem(key);
		case 'batch':
			const values = {};
			const keys = key;
			for (const key of keys) {
				try {
					values[key] = JSON.parse(localStorage.getItem(key));
				} catch (e) {
					console.warn('Failed to parse:', key, 'falling back to raw string.');
					values[key] = localStorage.getItem(key);
				}
			}
			return values;
		case 'set':
			return localStorage.setItem(key, JSON.stringify(value));
		case 'patch':
			try {
				const stored = JSON.parse(localStorage.getItem(key)) || {};
				localStorage.setItem(key, JSON.stringify(extendDeep(stored, value)));
			} catch (e) {
				throw new Error(`Failed to patch: ${key} - error: ${e}`);
			}
			break;
		case 'deletePath':
			try {
				const stored = JSON.parse(localStorage.getItem(key)) || {};
				value.split(',').reduce((obj, key, i, { length }) => {
					if (i < length - 1) return obj[key];
					delete obj[key];
				}, stored);
				localStorage.setItem(key, JSON.stringify(stored));
			} catch (e) {
				throw new Error(`Failed to delete path: ${value} on key: ${key} - error: ${e}`);
			}
			break;
		case 'delete':
			return localStorage.removeItem(key);
		case 'has':
			return key in localStorage;
		case 'keys':
			return Object.keys(localStorage);
		case 'clear':
			return localStorage.clear();
		default:
			throw new Error(`Invalid storage operation: ${operation}`);
	}
});

addListener('openNewTabs', ({ urls, focusIndex }, tab) => {
	// Really? No SafariBrowserTab::index?
	let currentIndex = Array.from(tab.browserWindow.tabs).findIndex(t => t === tab);
	if (currentIndex === -1) currentIndex = 2 ** 50; // 7881299347898367 more tabs may be safely opened
	urls.forEach((url, i) => (
		tab.browserWindow.openTab(
			i === focusIndex ? 'foreground' : 'background',
			++currentIndex
		).url = url
	));
});

addListener('isPrivateBrowsing', (request, tab) => tab.private);

addListener('multicast', (request, senderTab) =>
	Promise.all(
		Array.from(safari.application.browserWindows)
			.map(w => Array.from(w.tabs))
			.reduce((acc, tabs) => acc.concat(tabs), [])
			.filter(tab => tab !== senderTab && tab.private === senderTab.private && tab.page)
			.map(tab => sendMessage('multicast', request, tab))
	)
);
