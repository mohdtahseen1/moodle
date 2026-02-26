<?php
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
 * Helper class for gradehistory report.
 *
 * @package    gradereport_history
 * @copyright  2014 onwards Ankit Agarwal <ankit.agrr@gmail.com>
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace gradereport_history;

/**
 * Helper class for gradehistory report.
 *
 * @since      Moodle 2.8
 * @package    gradereport_history
 * @copyright  2014 onwards Ankit Agarwal <ankit.agrr@gmail.com>
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class helper {

    /**
     * Initialise the js to handle the user selection {@link gradereport_history_user_button}.
     *
     * @param int $courseid       course id.
     * @param array $currentusers List of currently selected users.
     *
     * @return output\user_button the user select button.
     */
    public static function init_js($courseid, ?array $currentusers = null) {
        global $PAGE;

        // Load the strings for js.
        $PAGE->requires->strings_for_js([
            'errajaxsearch',
            'finishselectingusers',
            'foundoneuser',
            'foundnusers',
            'selectusers',
        ], 'gradereport_history');
        $PAGE->requires->strings_for_js([
            'loading',
        ], 'admin');
        $PAGE->requires->strings_for_js([
            'noresults',
            'search',
        ], 'moodle');

        $arguments = [
            'courseid'            => $courseid,
            'ajaxurl'             => '/grade/report/history/users_ajax.php',
            'url'                 => $PAGE->url->out(false),
        ];

        // Store selected users in data attribute on the button container.
        if ($currentusers !== null && !empty($currentusers)) {
            $selectedusersjson = json_encode($currentusers);
            $PAGE->requires->js_amd_inline("
                require(['jquery'], function($) {
                    $(function() {
                        $('.gradereport_history_plugin').attr('data-selected-users', " . json_encode($selectedusersjson) . ");
                    });
                });
            ");
        }

        // Load the ESM module.
        $PAGE->requires->js_call_amd('gradereport_history/userselector', 'init', [$arguments]);
    }

    /**
     * Retrieve a list of users.
     *
     * We're interested in anyone that had a grade history in this course. This api returns a list of such users based on various
     * criteria passed.
     *
     * @param \context $context Context of the page where the results would be shown.
     * @param string $search the text to search for (empty string = find all).
     * @param int $page page number, defaults to 0.
     * @param int $perpage Number of entries to display per page, defaults to 0 (all results).
     *
     * @return array list of users.
     */
    public static function get_users($context, $search = '', $page = 0, $perpage = 0) {
        global $DB;

        [$sql, $params] = self::get_users_sql_and_params($context, $search, false);
        $limitfrom = $perpage > 0 ? $page * $perpage : 0;
        $limitto = $perpage > 0 ? $limitfrom + $perpage : 0;
        $users = $DB->get_records_sql($sql, $params, $limitfrom, $limitto);
        return $users;
    }

    /**
     * Get total number of users present for the given search criteria.
     *
     * @param \context $context Context of the page where the results would be shown.
     * @param string $search the text to search for (empty string = find all).
     *
     * @return int number of users found.
     */
    public static function get_users_count($context, $search = '') {
        global $DB;

        [$sql, $params] = self::get_users_sql_and_params($context, $search, true);
        return $DB->count_records_sql($sql, $params);

    }

    /**
     * Get sql and params to use to get list of users.
     *
     * @param \context $context Context of the page where the results would be shown.
     * @param string $search the text to search for (empty string = find all).
     * @param bool $count setting this to true, returns an sql to get count only instead of the complete data records.
     *
     * @return array sql and params list
     */
    protected static function get_users_sql_and_params($context, $search = '', $count = false) {
        global $DB, $USER;
        $userfieldsapi = \core_user\fields::for_identity($context)->with_userpic()->including('username');
        $userfieldssql = $userfieldsapi->get_sql('u', true, '', '', false);
        // Fields we need from the user table.
        $extrafields = [];
        foreach ($userfieldsapi->get_required_fields([\core_user\fields::PURPOSE_IDENTITY]) as $field) {
            $extrafields[$field] = $userfieldssql->mappings[$field];
        }
        $params = [];
        if (!empty($search)) {
            list($filtersql, $params) = users_search_sql($search, 'u', USER_SEARCH_CONTAINS, $extrafields);
            $filtersql .= ' AND ';
        } else {
            $filtersql = '';
        }

        $userfieldjoinssql = $userfieldssql->joins;
        if ($count) {
            $select = "SELECT COUNT(DISTINCT u.id) ";
            $orderby = "";
        } else {
            $select = "SELECT DISTINCT $userfieldssql->selects ";
            $orderby = " ORDER BY u.lastname ASC, u.firstname ASC";
        }

        $groupjoinsql = '';
        $groupwheresql = '';
        $courseid = $context->instanceid;
        $groupmode = groups_get_course_groupmode(get_course($courseid));

        if ($groupmode == SEPARATEGROUPS && !has_capability('moodle/site:accessallgroups', $context)) {
            // We're only interested in separate groups mode because
            // it's the only group mode that requires the user to be a member of
            // specific group(s), except when they have the 'moodle/site:accessallgroups' capability.
            // Fetch the groups that the user can see.
            $groups = groups_get_all_groups($courseid, $USER->id, 0, 'g.id');
            // Add join condition to include users that only belong to the same group as the user.
            [$insql, $inparams] = $DB->get_in_or_equal(array_keys($groups), SQL_PARAMS_NAMED, 'gid', true, 0);
            $groupjoinsql = " JOIN {groups_members} gm ON gm.userid = u.id ";
            $groupwheresql = " AND gm.groupid $insql ";
            $params = array_merge($params, $inparams);
        }

        $sql = "$select
                 FROM {user} u
                 JOIN {grade_grades_history} ggh ON u.id = ggh.userid
                 JOIN {grade_items} gi ON gi.id = ggh.itemid
                 $userfieldjoinssql
                 $groupjoinsql
                WHERE $filtersql gi.courseid = :courseid $groupwheresql";
        $sql .= $orderby;
        $params['courseid'] = $courseid;
        $params = array_merge($userfieldssql->params, $params);
        return [$sql, $params];
    }

    /**
     * Get a list of graders.
     *
     * @param int $courseid Id of course for which we need to fetch graders.
     *
     * @return array list of graders.
     */
    public static function get_graders($courseid) {
        global $DB, $USER;

        $groupjoinsql = $groupwheresql = '';
        $inparams = [];
        $groupmode = groups_get_course_groupmode(get_course($courseid));
        if ($groupmode == SEPARATEGROUPS && !has_capability('moodle/site:accessallgroups', \context_course::instance($courseid))) {
            // Fetch the groups that the user can see.
            $groups = groups_get_all_groups($courseid, $USER->id, 0, 'g.id');
            // Add join condition to include users that only belong to the same group as the user.
            [$insql, $inparams] = $DB->get_in_or_equal(array_keys($groups), SQL_PARAMS_NAMED, 'gid', true, 0);
            $groupjoinsql = " JOIN {groups_members} gm ON gm.userid = u.id ";
            $groupwheresql = " AND gm.groupid $insql ";
        }

        $userfieldsapi = \core_user\fields::for_name();
        $ufields = $userfieldsapi->get_sql('u', false, '', '', false)->selects;
        $sql = "SELECT u.id, $ufields
                  FROM {user} u
                  JOIN {grade_grades_history} ggh ON ggh.usermodified = u.id
                  JOIN {grade_items} gi ON gi.id = ggh.itemid
                 $groupjoinsql
                 WHERE gi.courseid = :courseid $groupwheresql
              GROUP BY u.id, $ufields
              ORDER BY u.lastname ASC, u.firstname ASC";

        $graders = $DB->get_records_sql($sql, ['courseid' => $courseid] + $inparams);
        $return = [0 => get_string('allgraders', 'gradereport_history')];
        foreach ($graders as $grader) {
            $return[$grader->id] = fullname($grader);
        }
        return $return;
    }
}
