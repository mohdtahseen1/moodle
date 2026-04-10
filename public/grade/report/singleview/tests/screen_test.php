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

namespace gradereport_singleview;

use gradereport_singleview_screen_testable;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once(__DIR__ . '/fixtures/screen.php');
require_once($CFG->libdir . '/gradelib.php');

/**
 * Tests for screen class.
 *
 * @package    gradereport_singleview
 * @category   test
 * @copyright  2014 onwards Simey Lameze <simey@moodle.com>
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
final class screen_test extends \advanced_testcase {

    /**
     * Test that a locked, overridden grade keeps its override flag after a singleview save.
     *
     * Disabled checkboxes (locked grades) do not submit a POST value; without the fix
     * the missing value gets synthesised as false and then strips the override.
     *
     * @covers \gradereport_singleview\local\screen\grade::process
     * @dataProvider locked_override_provider
     * @param bool $lockgradeitem Whether to lock the grade_item (true) or the individual grade_grade (false).
     */
    public function test_locked_override_is_not_unset_on_process(bool $lockgradeitem): void {
        $this->resetAfterTest();
        $this->setAdminUser();

        $course  = $this->getDataGenerator()->create_course();
        $student = $this->getDataGenerator()->create_user();
        $this->getDataGenerator()->enrol_user($student->id, $course->id);

        $record    = $this->getDataGenerator()->create_grade_item(['courseid' => $course->id]);
        $gradeitem = \grade_item::fetch(['id' => $record->id]);
        $gradeitem->update_final_grade($student->id, 75.0, 'unittest');

        // Regrading clears needsupdate on the whole tree so that set_locked() takes immediate
        // effect and the screen constructor's grade-verification check passes.
        grade_regrade_final_grades($course->id);
        $gradeitem = \grade_item::fetch(['id' => $gradeitem->id]);

        $grade = \grade_grade::fetch(['itemid' => $gradeitem->id, 'userid' => $student->id]);
        $grade->set_overridden(true);

        if ($lockgradeitem) {
            $gradeitem->set_locked(1);
        } else {
            $grade = \grade_grade::fetch(['itemid' => $gradeitem->id, 'userid' => $student->id]);
            $grade->set_locked(1);
        }

        $screen = new \gradereport_singleview\local\screen\grade($course->id, $gradeitem->id, 0);

        // Disabled checkboxes are excluded from browser POST submissions. Simulate that: the
        // hidden oldoverride sentinel is present but the override checkbox value is absent.
        $data = new \stdClass();
        $data->{"oldoverride_{$gradeitem->id}_{$student->id}"} = 1;
        ob_start();
        $screen->process($data);
        ob_end_clean();

        $updated = \grade_grade::fetch(['itemid' => $gradeitem->id, 'userid' => $student->id]);
        $this->assertTrue((bool) $updated->overridden, 'Override flag must not be cleared for a locked grade.');
    }

    /**
     * Data provider for {@see test_locked_override_is_not_unset_on_process}.
     *
     * @return array
     */
    public static function locked_override_provider(): array {
        return [
            'grade_item locked' => [true],
            'grade_grade locked' => [false],
        ];
    }

    /**
     * Test load_users method.
     */
    public function test_load_users(): void {
        global $DB;

        $this->setAdminUser();
        $this->resetAfterTest(true);

        $roleteacher = $DB->get_record('role', ['shortname' => 'teacher'], '*', MUST_EXIST);

        // Create a course, users and groups.
        $course = $this->getDataGenerator()->create_course();
        $coursecontext = \context_course::instance($course->id);
        $group = $this->getDataGenerator()->create_group(['courseid' => $course->id]);
        $teacher = $this->getDataGenerator()->create_user();
        $user1 = $this->getDataGenerator()->create_user();
        $user2 = $this->getDataGenerator()->create_user();
        $this->getDataGenerator()->enrol_user($teacher->id, $course->id, $roleteacher->id);
        $this->getDataGenerator()->enrol_user($user1->id, $course->id);
        $this->getDataGenerator()->enrol_user($user2->id, $course->id);
        $this->getDataGenerator()->create_group_member(['groupid' => $group->id, 'userid' => $teacher->id]);
        $this->getDataGenerator()->create_group_member(['groupid' => $group->id, 'userid' => $user1->id]);
        $this->getDataGenerator()->create_group_member(['groupid' => $group->id, 'userid' => $user2->id]);

        // Perform a regrade before creating the report.
        grade_regrade_final_grades($course->id);
        $screentest = new gradereport_singleview_screen_testable($course->id, 0, $group->id);
        $groupusers = $screentest->test_load_users();
        $this->assertDebuggingCalled('The function load_users() is deprecated. ' .
            'Please use grade_report::get_gradable_users() instead.');
        $this->assertCount(2, $groupusers);

        // Now, let's suspend the enrolment of a user. Should return only one user.
        $this->getDataGenerator()->enrol_user($user2->id, $course->id, $roleteacher->id, 'manual', 0, 0, ENROL_USER_SUSPENDED);
        $users = $screentest->test_load_users();
        $this->assertDebuggingCalled('The function load_users() is deprecated. ' .
            'Please use grade_report::get_gradable_users() instead.');
        $this->assertCount(1, $users);

        // Change the viewsuspendedusers capabilities and set the user preference to display suspended users.
        assign_capability('moodle/course:viewsuspendedusers', CAP_ALLOW, $roleteacher->id, $coursecontext, true);
        set_user_preference('grade_report_showonlyactiveenrol', false, $teacher);
        accesslib_clear_all_caches_for_unit_testing();
        $this->setUser($teacher);
        $screentest = new gradereport_singleview_screen_testable($course->id, 0, $group->id);
        $users = $screentest->test_load_users();
        $this->assertDebuggingCalled('The function load_users() is deprecated. ' .
            'Please use grade_report::get_gradable_users() instead.');
        $this->assertCount(2, $users);

        // Change the capability again, now the user can't see the suspended enrolments.
        assign_capability('moodle/course:viewsuspendedusers', CAP_PROHIBIT, $roleteacher->id, $coursecontext, true);
        set_user_preference('grade_report_showonlyactiveenrol', false, $teacher);
        accesslib_clear_all_caches_for_unit_testing();
        $users = $screentest->test_load_users();
        $this->assertDebuggingCalled('The function load_users() is deprecated. ' .
            'Please use grade_report::get_gradable_users() instead.');
        $this->assertCount(1, $users);

        // Now, activate the user enrolment again. We shall get 2 users now.
        $this->getDataGenerator()->enrol_user($user2->id, $course->id, $roleteacher->id, 'manual', 0, 0, ENROL_USER_ACTIVE);
        $users = $screentest->test_load_users();
        $this->assertDebuggingCalled('The function load_users() is deprecated. ' .
            'Please use grade_report::get_gradable_users() instead.');
        $this->assertCount(2, $users);
    }
}
