// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * User selector module for grade history report.
 *
 * @module     gradereport_history/userselector
 * @copyright  2025 onwards
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Ajax from 'core/ajax';
import ModalFactory from 'core/modal_factory';
import ModalEvents from 'core/modal_events';
import Templates from 'core/templates';
import Notification from 'core/notification';
import {get_string as getString} from 'core/str';

const SELECTORS = {
    TRIGGER: '.gradereport_history_plugin input.selectortrigger',
    SEARCHFIELD: '.usp-search-field',
    SEARCHBTN: '.usp-search-btn',
    SEARCHFORM: '.usp-search form',
    SELECTALL: '.usp-select-all-checkbox',
    SELECTALLWRAPPER: '.usp-select-all-wrapper',
    RESULTSCOUNT: '.usp-results-count',
    RESULTSUSERS: '.usp-search-results .usp-users',
    USER: '.usp-user',
    USERSELECT: '.usp-checkbox input[type=checkbox]',
    PICTURE: '.usp-user .userpicture',
    FULLNAME: '.fullname label',
    AJAXCONTENT: '.usp-ajax-content',
    LIGHTBOX: '.usp-loading-lightbox',
    SELECTEDNAMES: '.felement .selectednames',
    USERIDS: 'input[name="userids"]',
    USERFULLNAMES: 'input[name="userfullnames"]',
};

const CSS = {
    HIDDEN: 'hidden',
    SELECTED: 'selected',
    FIRSTADDED: 'usp-first-added',
    USER: 'usp-user',
    USERS: 'usp-users',
    CHECKBOX: 'usp-checkbox',
    PICTURE: 'usp-picture',
    DETAILS: 'details',
    FULLNAME: 'fullname',
    EXTRAFIELDS: 'extrafields',
    SEARCHRESULTS: 'usp-search-results',
};

/**
 * User Selector class.
 */
class UserSelector {
    /**
     * Constructor for the UserSelector.
     *
     * @param {Object} config Configuration options
     */
    constructor(config) {
        this.courseid = config.courseid;

        // Read selected users from data attribute if not provided in config.
        if (config.selectedUsers) {
            this.selectedUsers = config.selectedUsers;
        } else {
            // Try to read from data attribute on the button container.
            const container = document.querySelector('.gradereport_history_plugin');
            if (container && container.dataset.selectedUsers) {
                try {
                    this.selectedUsers = JSON.parse(container.dataset.selectedUsers);
                } catch (e) {
                    this.selectedUsers = {};
                }
            } else {
                this.selectedUsers = {};
            }
        }

        this.usersBufferList = {};
        this.userCount = 0;
        this.modal = null;
        this.userTabFocus = null;
        this.firstDisplay = true;

        // State preservation for modal cancel/dismiss.
        this.savedState = {
            selectedUsers: {},
            searchValue: '',
            selectAllChecked: false,
        };

        this.init();
    }

    /**
     * Initialize the user selector.
     */
    async init() {
        const trigger = document.querySelector(SELECTORS.TRIGGER);
        if (trigger) {
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                this.show();
            });
        }
    }

    /**
     * Show the user selector modal.
     */
    async show() {
        this.usersBufferList = {...this.selectedUsers};

        if (!this.modal) {
            await this.createModal();
        }

        // Restore the last saved state (search, selections)
        const root = this.modal.getRoot()[0];
        const searchField = root.querySelector(SELECTORS.SEARCHFIELD);

        if (searchField && this.savedState.searchValue !== undefined) {
            searchField.value = this.savedState.searchValue;
        }

        if (this.firstDisplay) {
            this.firstDisplay = false;
            // Save initial state
            this.saveCurrentState();

            // Don't search on first display
            const ajaxContent = root.querySelector(SELECTORS.AJAXCONTENT);
            const resultsCount = root.querySelector(SELECTORS.RESULTSCOUNT);
            const selectAllWrapper = root.querySelector(SELECTORS.SELECTALLWRAPPER);

            if (ajaxContent) {
                ajaxContent.innerHTML = '';
            }
            if (resultsCount) {
                resultsCount.textContent = '';
            }
            if (selectAllWrapper) {
                selectAllWrapper.style.display = 'none';
            }
        } else {
            // Re-run search to restore results display
            if (this.savedState.searchValue) {
                await this.search(false);
            }
            // Reset selections to match buffer list
            this.resetSelections();
        }

        this.modal.show();
    }

    /**
     * Create the modal dialogue.
     */
    async createModal() {
        const [title, searchLabel, searchPlaceholder, loadingLabel, finishLabel,
               selectAllLabel] = await Promise.all([
            getString('selectusers', 'gradereport_history'),
            getString('search', 'moodle'),
            getString('searchplaceholder', 'gradereport_history'),
            getString('loading', 'admin'),
            getString('finishselectingusers', 'gradereport_history'),
            getString('selectall', 'gradereport_history'),
        ]);

        const context = {
            searchlabel: searchLabel,
            searchplaceholder: searchPlaceholder,
            loadinglabel: loadingLabel,
            finishlabel: finishLabel,
            selectalllabel: selectAllLabel,
        };

        const body = await Templates.render('gradereport_history/userselector_body', context);

        this.modal = await ModalFactory.create({
            type: ModalFactory.types.SAVE_CANCEL,
            title: title,
            body: body,
            large: true,
        });

        // Add custom CSS class for styling
        this.modal.getRoot().addClass('gradereport_history_usp');

        // Change the save button text
        const saveBtn = this.modal.getFooter().find('[data-action="save"]');
        saveBtn.text(finishLabel);

        this.setupModalEvents();
    }

    /**
     * Setup event listeners for the modal.
     */
    setupModalEvents() {
        const root = this.modal.getRoot()[0];

        // Select all checkbox
        const selectAllCheckbox = root.querySelector(SELECTORS.SELECTALL);
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                this.selectAllUsers(e.target.checked);
            });
        }

        // Search button click
        const searchBtn = root.querySelector(SELECTORS.SEARCHBTN);
        if (searchBtn) {
            searchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.search(false);
            });
        }

        // Search form submit
        const searchForm = root.querySelector(SELECTORS.SEARCHFORM);
        if (searchForm) {
            searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.search(false);
            });
        }

        // Delegate user selection
        root.addEventListener('click', (e) => {
            const checkbox = e.target.closest(SELECTORS.USERSELECT);
            const picture = e.target.closest(SELECTORS.PICTURE);

            if (checkbox) {
                this.selectUser(e);
            } else if (picture) {
                const userNode = picture.closest(SELECTORS.USER);
                if (userNode) {
                    const checkboxInput = userNode.querySelector(SELECTORS.USERSELECT);
                    if (checkboxInput) {
                        checkboxInput.checked = !checkboxInput.checked;
                        this.selectUser(e, checkboxInput);
                    }
                }
            }
        });

        // Keyboard navigation
        root.addEventListener('keydown', (e) => {
            if (e.target.matches(SELECTORS.USERSELECT)) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    this.userKeyboardNavigation(e);
                }
            }
        });

        // Save button (finish selecting)
        this.modal.getRoot().on(ModalEvents.save, () => {
            this.finishSelectingUsers();
        });

        // Handle modal close/cancel - restore saved state.
        this.modal.getRoot().on(ModalEvents.hidden, () => {
            this.restoreState();
        });
    }

    /**
     * Save the current state for restoration on cancel.
     */
    saveCurrentState() {
        const root = this.modal ? this.modal.getRoot()[0] : null;
        if (!root) {
            return;
        }

        const searchField = root.querySelector(SELECTORS.SEARCHFIELD);
        const selectAllCheckbox = root.querySelector(SELECTORS.SELECTALL);

        this.savedState = {
            selectedUsers: {...this.selectedUsers},
            searchValue: searchField ? searchField.value : '',
            selectAllChecked: selectAllCheckbox ? selectAllCheckbox.checked : false,
        };
    }

    /**
     * Restore the saved state when modal is cancelled/dismissed.
     */
    restoreState() {
        // Restore selected users.
        this.selectedUsers = {...this.savedState.selectedUsers};
        this.usersBufferList = {...this.savedState.selectedUsers};

        // State will be restored on next show()
    }

    /**
     * Search for users.
     *
     * @param {Boolean} append Whether to append results or replace them
     */
    async search(append = false) {
        const root = this.modal.getRoot()[0];
        const searchField = root.querySelector(SELECTORS.SEARCHFIELD);
        const searchValue = searchField ? searchField.value.trim() : '';

        // Validate: Require at least 3 characters for all searches
        if (searchValue.length < 3) {
            const resultsCount = root.querySelector(SELECTORS.RESULTSCOUNT);
            if (resultsCount) {
                const errorMsg = await getString('errorminchars', 'gradereport_history');
                resultsCount.textContent = errorMsg;
            }
            const ajaxContent = root.querySelector(SELECTORS.AJAXCONTENT);
            if (ajaxContent) {
                ajaxContent.innerHTML = '';
            }
            // Hide select all wrapper
            const selectAllWrapper = root.querySelector(SELECTORS.SELECTALLWRAPPER);
            if (selectAllWrapper) {
                selectAllWrapper.style.display = 'none';
            }
            return;
        }

        this.userCount = 0;

        // Show loading indicator
        this.preSearch(append);

        try {
            const response = await Ajax.call([{
                methodname: 'gradereport_history_search_users',
                args: {
                    courseid: this.courseid,
                    search: searchValue,
                },
            }])[0];

            await this.processSearchResults(response, append);
        } catch (error) {
            await this.handleSearchError(error);
        }

        this.postSearch(append);
    }

    /**
     * Pre-search operations.
     *
     * @param {Boolean} append Whether we're appending results
     */
    preSearch(append) {
        const root = this.modal.getRoot()[0];
        const lightbox = root.querySelector(SELECTORS.LIGHTBOX);
        const resultsCount = root.querySelector(SELECTORS.RESULTSCOUNT);

        if (lightbox) {
            lightbox.classList.remove(CSS.HIDDEN);
        }

        if (!append && resultsCount) {
            getString('loading', 'admin').then((str) => {
                resultsCount.textContent = str;
                return;
            }).catch(Notification.exception);
        }
    }

    /**
     * Post-search operations.
     *
     * @param {Boolean} append Whether we appended results
     */
    postSearch(append) {
        const root = this.modal.getRoot()[0];
        const lightbox = root.querySelector(SELECTORS.LIGHTBOX);

        if (lightbox) {
            lightbox.classList.add(CSS.HIDDEN);
        }

        if (append) {
            const firstAdded = root.querySelector('.' + CSS.FIRSTADDED);
            if (firstAdded) {
                this.setUserTabFocus(firstAdded);
                const checkbox = firstAdded.querySelector(SELECTORS.USERSELECT);
                if (checkbox) {
                    checkbox.focus();
                }
            }
        } else {
            const firstUser = root.querySelector(SELECTORS.USER);
            if (firstUser) {
                this.setUserTabFocus(firstUser);
            }
        }
    }

    /**
     * Process search results.
     *
     * @param {Object} result The search results
     */
    async processSearchResults(result) {
        const root = this.modal.getRoot()[0];
        const ajaxContent = root.querySelector(SELECTORS.AJAXCONTENT);
        const resultsCount = root.querySelector(SELECTORS.RESULTSCOUNT);
        const selectAllWrapper = root.querySelector(SELECTORS.SELECTALLWRAPPER);

        if (!result || !result.users) {
            return;
        }

        const totalUsers = parseInt(result.totalusers, 10);

        // Create new results container (no more appending/pagination)
        if (totalUsers === 0) {
            const noResults = await getString('noresults', 'moodle');
            resultsCount.textContent = noResults;
            ajaxContent.innerHTML = '';
            if (selectAllWrapper) {
                selectAllWrapper.style.display = 'none';
            }
            return;
        }

        // Update results count
        if (totalUsers === 1) {
            const foundOne = await getString('foundoneuser', 'gradereport_history');
            resultsCount.textContent = foundOne;
        } else {
            const foundN = await getString('foundnusers', 'gradereport_history', totalUsers);
            resultsCount.textContent = foundN;
        }

        // Show select all wrapper
        if (selectAllWrapper) {
            selectAllWrapper.style.display = 'block';

            // Check "select all" checkbox only if ALL displayed users are already selected.
            const selectAllCheckbox = root.querySelector(SELECTORS.SELECTALL);
            if (selectAllCheckbox) {
                let allSelected = true;
                for (const user of result.users) {
                    if (!this.usersBufferList.hasOwnProperty(user.userid)) {
                        allSelected = false;
                        break;
                    }
                }
                selectAllCheckbox.checked = allSelected;
            }
        }

        const usersContainer = document.createElement('div');
        usersContainer.setAttribute('role', 'listbox');
        usersContainer.setAttribute('aria-activedescendant', '');
        usersContainer.setAttribute('aria-multiselectable', 'true');
        usersContainer.className = CSS.USERS;

        // Add each user
        for (const user of result.users) {
            this.userCount++;
            const selected = this.usersBufferList.hasOwnProperty(user.userid);
            const userNode = await this.createUserNode(user, selected);
            usersContainer.appendChild(userNode);
        }

        // Create results wrapper (no more pagination, no "load more" button)
        const resultsWrapper = document.createElement('div');
        resultsWrapper.className = CSS.SEARCHRESULTS;
        resultsWrapper.appendChild(usersContainer);

        ajaxContent.innerHTML = '';
        ajaxContent.appendChild(resultsWrapper);
    }

    /**
     * Create a user node element.
     *
     * @param {Object} user User data
     * @param {Boolean} selected Whether user is selected
     * @returns {HTMLElement} The user node
     */
    async createUserNode(user, selected) {
        const checkboxId = 'usp-u-' + user.userid + '-' + Math.random().toString(36).substr(2, 9);
        const extraFieldsId = 'extra-' + checkboxId;

        const userNode = document.createElement('div');
        userNode.setAttribute('role', 'option');
        userNode.setAttribute('aria-selected', selected ? 'true' : 'false');
        userNode.className = CSS.USER + ' clearfix';
        userNode.dataset.userid = user.userid;

        const checkboxDiv = document.createElement('div');
        checkboxDiv.className = CSS.CHECKBOX;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'usp-u' + user.userid;
        checkbox.id = checkboxId;
        checkbox.tabIndex = -1;
        checkbox.checked = selected;
        checkbox.setAttribute('aria-describedby', `${checkboxId} ${extraFieldsId}`);
        checkboxDiv.appendChild(checkbox);

        const pictureDiv = document.createElement('div');
        pictureDiv.className = CSS.PICTURE;
        pictureDiv.innerHTML = user.picture;

        const detailsDiv = document.createElement('div');
        detailsDiv.className = CSS.DETAILS;

        const fullnameDiv = document.createElement('div');
        fullnameDiv.className = CSS.FULLNAME;
        const label = document.createElement('label');
        label.setAttribute('for', checkboxId);
        label.textContent = user.fullname;
        fullnameDiv.appendChild(label);

        const extraFieldsDiv = document.createElement('div');
        extraFieldsDiv.id = extraFieldsId;
        extraFieldsDiv.className = CSS.EXTRAFIELDS;
        extraFieldsDiv.innerHTML = user.extrafields || '';

        detailsDiv.appendChild(fullnameDiv);
        detailsDiv.appendChild(extraFieldsDiv);

        userNode.appendChild(checkboxDiv);
        userNode.appendChild(pictureDiv);
        userNode.appendChild(detailsDiv);

        if (selected) {
            userNode.classList.add(CSS.SELECTED);
        }

        return userNode;
    }

    /**
     * Handle search error.
     *
     * @param {Error} error The error object
     */
    async handleSearchError(error) {
        const root = this.modal.getRoot()[0];
        const ajaxContent = root.querySelector(SELECTORS.AJAXCONTENT);
        const resultsCount = root.querySelector(SELECTORS.RESULTSCOUNT);

        const errorMsg = await getString('errajaxsearch', 'gradereport_history');
        ajaxContent.innerHTML = '';
        resultsCount.textContent = errorMsg;

        Notification.exception(error);
    }

    /**
     * Select or deselect a user.
     *
     * @param {Event} e The event
     * @param {HTMLElement} checkboxOverride Optional checkbox element
     */
    selectUser(e, checkboxOverride = null) {
        const checkbox = checkboxOverride || e.target;
        const userNode = checkbox.closest(SELECTORS.USER);

        if (!userNode) {
            return;
        }

        const userId = userNode.dataset.userid;
        const fullnameLabel = userNode.querySelector(SELECTORS.FULLNAME);
        const fullname = fullnameLabel ? fullnameLabel.textContent : '';
        const checked = checkbox.checked;

        if (checked) {
            this.usersBufferList[userId] = fullname;
        } else {
            delete this.usersBufferList[userId];
            delete this.usersBufferList[parseInt(userId, 10)];
        }

        this.markUserNode(userNode, checked);
    }

    /**
     * Mark a user node as selected or not.
     *
     * @param {HTMLElement} node The user node
     * @param {Boolean} selected Whether selected
     */
    markUserNode(node, selected) {
        const checkbox = node.querySelector(SELECTORS.USERSELECT);

        if (selected) {
            node.classList.add(CSS.SELECTED);
            node.setAttribute('aria-selected', 'true');
            if (checkbox) {
                checkbox.checked = true;
            }
        } else {
            node.classList.remove(CSS.SELECTED);
            node.setAttribute('aria-selected', 'false');
            if (checkbox) {
                checkbox.checked = false;
            }
        }
    }

    /**
     * Select or deselect all currently displayed users.
     *
     * @param {Boolean} checked Whether to select or deselect all
     */
    selectAllUsers(checked) {
        const root = this.modal.getRoot()[0];
        const userNodes = root.querySelectorAll(SELECTORS.RESULTSUSERS + ' ' + SELECTORS.USER);

        userNodes.forEach(node => {
            const userId = node.dataset.userid;
            const fullnameElement = node.querySelector(SELECTORS.FULLNAME);
            const fullname = fullnameElement ? fullnameElement.textContent.trim() : '';

            if (checked) {
                this.usersBufferList[userId] = fullname;
            } else {
                delete this.usersBufferList[userId];
                delete this.usersBufferList[parseInt(userId, 10)];
            }

            this.markUserNode(node, checked);
        });
    }

    /**
     * Finish selecting users and close modal.
     */
    finishSelectingUsers() {
        this.applySelection();
        // Save the new state as the committed state
        this.saveCurrentState();
        this.modal.hide();
    }

    /**
     * Apply the current selection.
     */
    applySelection() {
        const userIds = Object.keys(this.usersBufferList);
        this.selectedUsers = {...this.usersBufferList};

        this.setNameDisplay();

        const userIdsField = document.querySelector(SELECTORS.USERIDS);
        if (userIdsField) {
            userIdsField.value = userIds.join(',');
        }
    }

    /**
     * Display selected user names.
     */
    setNameDisplay() {
        const nameList = Object.values(this.selectedUsers);
        const selectedNamesEl = document.querySelector(SELECTORS.SELECTEDNAMES);
        const userFullnamesEl = document.querySelector(SELECTORS.USERFULLNAMES);

        if (selectedNamesEl) {
            selectedNamesEl.innerHTML = nameList.join(', ');
        }

        if (userFullnamesEl) {
            userFullnamesEl.value = nameList.join();
        }
    }

    /**
     * Reset selections to match buffer list.
     */
    resetSelections() {
        const root = this.modal.getRoot()[0];
        const userNodes = root.querySelectorAll(SELECTORS.USER);

        // Deselect all users first
        userNodes.forEach((node) => {
            this.markUserNode(node, false);
        });

        // Select users in buffer list
        Object.keys(this.usersBufferList).forEach((userId) => {
            const userNode = root.querySelector(`${SELECTORS.USER}[data-userid="${userId}"]`);
            if (userNode) {
                this.markUserNode(userNode, true);
            }
        });

        // Update "Select all" checkbox to reflect whether all displayed users are selected
        const selectAllCheckbox = root.querySelector(SELECTORS.SELECTALL);
        if (selectAllCheckbox && userNodes.length > 0) {
            let allSelected = true;
            userNodes.forEach((node) => {
                const userId = node.dataset.userid;
                if (!this.usersBufferList.hasOwnProperty(userId)) {
                    allSelected = false;
                }
            });
            selectAllCheckbox.checked = allSelected;
        }

        // Reset tab focus
        const firstUser = root.querySelector(SELECTORS.USER);
        if (firstUser) {
            this.setUserTabFocus(firstUser);
        }
    }

    /**
     * Handle keyboard navigation between users.
     *
     * @param {KeyboardEvent} e The keyboard event
     */
    userKeyboardNavigation(e) {
        const root = this.modal.getRoot()[0];
        const users = Array.from(root.querySelectorAll(SELECTORS.USER));
        const currentUser = e.target.closest(SELECTORS.USER);

        if (!currentUser) {
            return;
        }

        const direction = e.key === 'ArrowUp' ? -1 : 1;
        const nextUser = this.findFocusableUser(users, currentUser, direction);

        if (nextUser) {
            e.preventDefault();
            const checkbox = nextUser.querySelector(SELECTORS.USERSELECT);
            if (checkbox) {
                checkbox.focus();
                this.setUserTabFocus(nextUser);
            }
        }
    }

    /**
     * Find the next focusable user.
     *
     * @param {Array} users Array of user nodes
     * @param {HTMLElement} currentUser Current user node
     * @param {Number} direction Direction to move (-1 or 1)
     * @returns {HTMLElement|null} Next user node or null
     */
    findFocusableUser(users, currentUser, direction) {
        const currentIndex = users.indexOf(currentUser);

        if (users.length < 1) {
            return null;
        }

        if (currentIndex < 0) {
            return users[0];
        }

        let nextIndex = currentIndex + direction;

        // Wrap around.
        if (nextIndex < 0) {
            nextIndex = users.length - 1;
        } else if (nextIndex >= users.length) {
            nextIndex = 0;
        }

        return users[nextIndex];
    }

    /**
     * Set the tab focus on a user.
     *
     * @param {HTMLElement} userNode The user node
     */
    setUserTabFocus(userNode) {
        if (this.userTabFocus) {
            this.userTabFocus.setAttribute('tabindex', '-1');
        }

        if (!userNode) {
            return;
        }

        const checkbox = userNode.querySelector(SELECTORS.USERSELECT);
        if (checkbox) {
            this.userTabFocus = checkbox;
            this.userTabFocus.setAttribute('tabindex', '0');

            const usersContainer = userNode.closest(SELECTORS.RESULTSUSERS);
            if (usersContainer && checkbox.id) {
                usersContainer.setAttribute('aria-activedescendant', checkbox.id);
            }
        }
    }
}

/**
 * Initialize the user selector with configuration.
 *
 * @param {Object} config Configuration object
 * @returns {UserSelector} UserSelector instance
 */
export const init = (config) => {
    return new UserSelector(config);
};

export default {init};
