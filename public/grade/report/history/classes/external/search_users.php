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
 * External API for searching users with grade history.
 *
 * @package    gradereport_history
 * @copyright  2025 onwards
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace gradereport_history\external;

use context_course;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_value;
use core_external\external_single_structure;
use core_external\external_multiple_structure;

/**
 * External API for searching users.
 *
 * @package    gradereport_history
 * @copyright  2025 onwards
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class search_users extends external_api {
    /**
     * Returns description of method parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters() {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'Course ID'),
            'search' => new external_value(PARAM_RAW, 'Search string', VALUE_DEFAULT, ''),
        ]);
    }

    /**
     * Search for users with grade history.
     *
     * @param int $courseid Course ID
     * @param string $search Search string
     * @return array
     */
    public static function execute($courseid, $search = '') {
        global $OUTPUT;

        // Validate parameters.
        $params = self::validate_parameters(self::execute_parameters(), [
            'courseid' => $courseid,
            'search' => $search,
        ]);

        // Validate context and permissions.
        $course = get_course($params['courseid']);
        if ($course->id == SITEID) {
            throw new \moodle_exception('invalidcourse');
        }
        $context = context_course::instance($course->id, MUST_EXIST);
        self::validate_context($context);

        require_capability('gradereport/history:view', $context);
        require_capability('moodle/grade:viewall', $context);

        // Get users with no pagination - return all results.
        $users = \gradereport_history\helper::get_users($context, $params['search']);
        $totalusers = \gradereport_history\helper::get_users_count($context, $params['search']);

        // Format user data.
        $userfieldsapi = \core_user\fields::for_identity($context)->with_userpic();
        $extrafields = $userfieldsapi->get_required_fields([\core_user\fields::PURPOSE_IDENTITY]);
        $useroptions = ['link' => false, 'visibletoscreenreaders' => false];

        $formattedusers = [];
        foreach ($users as $user) {
            $newuser = [
                'userid' => $user->id,
                'picture' => $OUTPUT->user_picture($user, $useroptions),
                'fullname' => fullname($user),
                'extrafields' => '',
            ];

            $fieldvalues = [];
            foreach ($extrafields as $field) {
                if (isset($user->{$field}) && $user->{$field}) {
                    $fieldcontent = $user->{$field};
                    if ($field === 'country') {
                        $countries = get_string_manager()->get_list_of_countries();
                        $fieldcontent = $countries[$fieldcontent] ?? $fieldcontent;
                    }
                    $fieldvalues[] = $fieldcontent;
                }
            }
            $newuser['extrafields'] = implode(', ', $fieldvalues);

            $formattedusers[] = $newuser;
        }

        return [
            'users' => $formattedusers,
            'totalusers' => $totalusers,
        ];
    }

    /**
     * Returns description of method result value.
     *
     * @return external_single_structure
     */
    public static function execute_returns() {
        return new external_single_structure([
            'users' => new external_multiple_structure(
                new external_single_structure([
                    'userid' => new external_value(PARAM_INT, 'User ID'),
                    'picture' => new external_value(PARAM_RAW, 'User picture HTML'),
                    'fullname' => new external_value(PARAM_TEXT, 'User full name'),
                    'extrafields' => new external_value(PARAM_RAW, 'Extra identity fields'),
                ])
            ),
            'totalusers' => new external_value(PARAM_INT, 'Total number of users'),
        ]);
    }
}
